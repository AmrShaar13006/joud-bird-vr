// Fixtures replay identically in Node, rulesets are versioned, and live play through
// advance() with any frame timing replays to the identical result.
import { describe, expect, it } from 'vitest';
import { botWantsFlap, DEFAULT_BOT } from './bot';
import { MODES, type Mode } from './config';
import { checkFixtures, diffResults, type FixtureFile } from './fixture-check';
import mobileFixtures from './fixtures/mobile-1.json';
import vrFixtures from './fixtures/vr-1.json';
import { Game } from './game';
import { replay } from './replay';
import { Prng } from './rng';
import { getRuleset, MOBILE1, RULESET_IDS, rulesetHash, rulesetIsConsistent, VR1 } from './ruleset';

const FILES = [mobileFixtures, vrFixtures] as unknown as FixtureFile[];

describe('fixtures (Node)', () => {
  for (const file of FILES) {
    describe(file.rulesetId, () => {
      it('constants hash matches the fixtures (changing rules needs a new id)', () => {
        expect(rulesetHash(getRuleset(file.rulesetId)!)).toBe(file.rulesetHash);
      });
      it.each(file.runs.map((r) => [r.name, r] as const))('%s replays identically', (_name, run) => {
        expect(diffResults(run.expected, replay(run.log))).toBeNull();
      });
    });
  }

  it('checkFixtures reports every run as passed', () => {
    const report = checkFixtures(FILES);
    expect(report.hashErrors).toEqual([]);
    expect(report.passed).toBe(report.total);
    expect(report.ok).toBe(true);
  });

  it('mobile-1 has at least 30 valid runs in every mode, plus invalid logs', () => {
    const valid = mobileFixtures.runs.filter((r) => r.expected.valid);
    expect(valid.length).toBeGreaterThanOrEqual(30);
    for (const m of MODES) expect(valid.some((r) => r.log.mode === m)).toBe(true);
    expect(mobileFixtures.runs.some((r) => !r.expected.valid)).toBe(true);
    // Long autopilot runs and random-tap runs are both present.
    expect(valid.some((r) => r.expected.endTick >= 10000)).toBe(true);
    expect(valid.some((r) => r.name.includes('taps'))).toBe(true);
  });

  it('mobile-1 fixtures cover every obstacle kind, both fork sides and flowers', () => {
    const totals = [0, 0, 0, 0, 0, 0];
    let safe = 0;
    let risky = 0;
    let flowers = 0;
    for (const run of mobileFixtures.runs) {
      if (!run.expected.valid) continue;
      const rs = getRuleset(run.log.rulesetId)!;
      const mode = run.log.mode as Mode;
      // Re-play the log tick by tick to read the coverage counters at the end.
      const g = new Game(rs.modes[mode], { ruleset: rs, mode, seed: run.log.seed });
      g.handle('start');
      g.handle('flap');
      let i = 1;
      while (g.state === 'playing' && g.tick < run.log.endTick) {
        g.step(rs.step);
        if (g.state === 'playing' && run.log.flaps[i] === g.tick) {
          g.handle('flap');
          i++;
        }
      }
      g.field.passedKinds.forEach((n, k) => (totals[k] += n));
      safe += g.field.forkSafe;
      risky += g.field.forkRisky;
      flowers += g.field.flowersTaken;
    }
    for (const n of totals) expect(n).toBeGreaterThan(0);
    expect(safe).toBeGreaterThan(0);
    expect(risky).toBeGreaterThan(0);
    expect(flowers).toBeGreaterThan(0);
  });

  it('every ruleset has a fixture file and a consistent step', () => {
    expect(FILES.map((f) => f.rulesetId).sort()).toEqual([...RULESET_IDS].sort());
    for (const id of RULESET_IDS) expect(rulesetIsConsistent(getRuleset(id)!)).toBe(true);
  });

  it('a changed constant changes the hash', () => {
    const tweaked = {
      ...MOBILE1,
      modes: { ...MOBILE1.modes, hard: { ...MOBILE1.modes.hard, gravity: -2.61 } },
    };
    expect(rulesetHash(tweaked)).not.toBe(rulesetHash(MOBILE1));
    // VR placement is not part of a result.
    const placed = { ...VR1, modes: { ...VR1.modes, easy: { ...VR1.modes.easy, rigDistance: 3 } } };
    expect(rulesetHash(placed)).toBe(rulesetHash(VR1));
  });
});

/** Read the state afresh (TypeScript narrows it across method calls). */
const ended = (g: Game): boolean => g.state === 'gameOver';

/**
 * Drive the live Game the way a shell does: random frame times (8–50 ms, hitches up to
 * 300 ms), input between frames, a pause now and then. Returns the game at game over.
 */
function playLive(rulesetId: string, mode: Mode, seed: number, driver: 'bot' | 'taps'): Game {
  const rs = getRuleset(rulesetId)!;
  const game = new Game(rs.modes[mode], { ruleset: rs, mode, seed });
  const r = new Prng(seed ^ 0x5bd1e995);
  game.handle('start');
  game.handle('flap');
  let frames = 0;
  while (game.state !== 'gameOver') {
    frames++;
    const dt = r.next() < 0.04 ? 0.05 + r.next() * 0.25 : 0.008 + r.next() * 0.042;
    game.advance(dt);
    if (ended(game)) break;
    if (game.state === 'paused') {
      game.handle(r.next() < 0.5 ? 'pause' : 'flap'); // resume
      continue;
    }
    if (r.next() < 0.002) {
      game.suspend(); // tab hidden
      continue;
    }
    // Give up flapping after a while so every run ends.
    const late = game.tick > 2400;
    let flap = false;
    if (!late) flap = driver === 'bot' ? botWantsFlap(game, DEFAULT_BOT) : r.next() < 0.12;
    if (flap) {
      game.handle('flap');
      if (r.next() < 0.2) game.handle('flap'); // double tap inside one frame
    }
    if (frames > 200000) throw new Error('run did not end');
  }
  return game;
}

describe('live play replays identically (500 seeds per mode)', () => {
  for (const id of RULESET_IDS) {
    for (const mode of MODES) {
      it(`${id} ${mode}`, () => {
        let ticks = 0;
        for (let s = 0; s < 500; s++) {
          const seed = (Math.imul(s + 1, 0x9e3779b1) ^ MODES.indexOf(mode)) >>> 0;
          const game = playLive(id, mode, seed, s % 2 === 0 ? 'bot' : 'taps');
          const log = game.lastRun!;
          expect(log.flaps[0]).toBe(0);
          for (let i = 1; i < log.flaps.length; i++) expect(log.flaps[i]).toBeGreaterThan(log.flaps[i - 1]);
          const diff = diffResults(game.lastResult!, replay(log));
          if (diff) throw new Error(`${id} ${mode} seed ${seed}: ${diff}`);
          ticks += log.endTick;
        }
        expect(ticks).toBeGreaterThan(500 * 60);
      }, 120_000);
    }
  }
});
