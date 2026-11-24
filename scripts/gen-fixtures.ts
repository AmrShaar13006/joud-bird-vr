// Writes src/core/fixtures/mobile-1.json and vr-1.json: recorded runs and their
// expected results. Run only on purpose (`npm run fixtures`), after a NEW ruleset id.
// Fixture runs are played through the live Game (bot or random taps), then replayed;
// the generator refuses to write if live and replay disagree or coverage is missing.

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type BotStyle, botWantsFlap, DEFAULT_BOT } from '../src/core/bot';
import { MODES, type Mode } from '../src/core/config';
import { diffResults, type FixtureFile, type FixtureRun } from '../src/core/fixture-check';
import { Game } from '../src/core/game';
import { replay } from '../src/core/replay';
import { Prng } from '../src/core/rng';
import { KINDS, MOBILE1, type Ruleset, rulesetHash, VR1 } from '../src/core/ruleset';
import type { RunLog } from '../src/core/run';

type Driver = { kind: 'bot'; style: BotStyle } | { kind: 'taps'; perSecond: number; tapSeed: number };

interface Played {
  run: FixtureRun;
  kinds: number[];
  forkSafe: number;
  forkRisky: number;
  flowers: number;
}

/** Play one round through the live Game, one tick at a time, deciding between ticks. */
function play(rs: Readonly<Ruleset>, mode: Mode, seed: number, driver: Driver, name: string): Played {
  const game = new Game(rs.modes[mode], { ruleset: rs, mode, seed });
  const taps = new Prng(driver.kind === 'taps' ? driver.tapSeed : 0);
  game.handle('start');
  game.handle('flap');
  while (game.state === 'playing') {
    game.step(rs.step);
    if (game.state !== 'playing') break;
    const flap =
      driver.kind === 'bot'
        ? botWantsFlap(game, driver.style)
        : taps.next() < driver.perSecond * rs.step;
    if (flap) game.handle('flap');
  }
  const log = game.lastRun as RunLog;
  const expected = replay(log);
  const diff = diffResults(game.lastResult!, expected);
  if (diff) throw new Error(`${rs.id}/${name}: live and replay differ (${diff})`);
  const f = game.field;
  return {
    run: { name, log, expected },
    kinds: f.passedKinds.slice(),
    forkSafe: f.forkSafe,
    forkRisky: f.forkRisky,
    flowers: f.flowersTaken,
  };
}

const bot = (over: Partial<BotStyle>): Driver => ({ kind: 'bot', style: { ...DEFAULT_BOT, ...over } });
const taps = (perSecond: number, tapSeed: number): Driver => ({ kind: 'taps', perSecond, tapSeed });

/** Malformed logs: every runtime must reject them with the same reason code. */
function invalidRuns(rs: Readonly<Ruleset>): FixtureRun[] {
  const base: RunLog = { rulesetId: rs.id, mode: 'normal', seed: 1, flaps: [0, 30, 60], endTick: 120 };
  const cases: [string, RunLog][] = [
    ['invalid-unknown-ruleset', { ...base, rulesetId: 'nope-9' }],
    ['invalid-unsorted', { ...base, flaps: [0, 60, 30] }],
    ['invalid-duplicate', { ...base, flaps: [0, 30, 30] }],
    ['invalid-flap-after-end', { ...base, flaps: [0, 30, 120] }],
    ['invalid-end-too-large', { ...base, endTick: rs.maxTicks + 1 }],
    ['invalid-first-flap', { ...base, flaps: [5, 30] }],
  ];
  return cases.map(([name, log]) => ({ name, log, expected: replay(log) }));
}

function generate(rs: Readonly<Ruleset>, perMode: (mode: Mode) => [string, number, Driver][]): FixtureFile {
  const runs: FixtureRun[] = [];
  const kinds = [0, 0, 0, 0, 0, 0];
  let forkSafe = 0;
  let forkRisky = 0;
  let flowers = 0;
  for (const mode of MODES) {
    for (const [label, seed, driver] of perMode(mode)) {
      const p = play(rs, mode, seed, driver, `${mode}-${label}`);
      runs.push(p.run);
      p.kinds.forEach((n, i) => (kinds[i] += n));
      forkSafe += p.forkSafe;
      forkRisky += p.forkRisky;
      flowers += p.flowers;
    }
  }
  runs.push(...invalidRuns(rs));
  const coverage = Object.fromEntries(KINDS.map((k, i) => [k, kinds[i]]));
  console.log(`${rs.id}: ${runs.length} runs, passed`, coverage, { forkSafe, forkRisky, flowers });
  if (rs.id === MOBILE1.id) {
    const missing = KINDS.filter((_, i) => kinds[i] === 0);
    if (missing.length || forkSafe === 0 || forkRisky === 0 || flowers === 0) {
      throw new Error(`mobile-1 coverage missing: ${missing.join(', ')} fork ${forkSafe}/${forkRisky} flowers ${flowers}`);
    }
  }
  return { rulesetId: rs.id, rulesetHash: rulesetHash(rs), runs };
}

/** Stable, diff-friendly JSON: one run per line. */
function format(file: FixtureFile): string {
  const runs = file.runs.map((r) => `    ${JSON.stringify(r)}`).join(',\n');
  return `{\n  "rulesetId": ${JSON.stringify(file.rulesetId)},\n  "rulesetHash": ${JSON.stringify(file.rulesetHash)},\n  "runs": [\n${runs}\n  ]\n}\n`;
}

const MOBILE_RUNS = (mode: Mode): [string, number, Driver][] => {
  const s = (n: number) => 1000 * (MODES.indexOf(mode) + 1) + n;
  return [
    ['bot-1', s(1), bot({ lead: 0, slack: 0.03 })],
    ['bot-2', s(2), bot({ lead: 0.03, slack: 0.04 })],
    ['bot-3', s(3), bot({ lead: 0.05, slack: 0.06 })],
    ['bot-risky-1', s(4), bot({ lead: 0, slack: 0.03, risky: true })],
    ['bot-risky-2', s(5), bot({ lead: 0.03, slack: 0.04, risky: true })],
    ['bot-aim-up', s(6), bot({ lead: 0.03, slack: 0.04, aim: 0.3 })],
    ['bot-long', s(7), bot({ lead: 0.03, slack: 0.03 })],
    ['taps-slow', s(8), taps(1.5, s(80))],
    ['taps-mid', s(9), taps(2.5, s(90))],
    ['taps-fast', s(10), taps(4, s(100))],
  ];
};

const VR_RUNS = (mode: Mode): [string, number, Driver][] => {
  const s = (n: number) => 100 * (MODES.indexOf(mode) + 1) + n;
  return [
    ['bot', s(1), bot({ lead: 0.05, slack: 0.08 })],
    ['bot-2', s(2), bot({ lead: 0.03, slack: 0.12 })],
    ['taps', s(3), taps(2, s(30))],
  ];
};

export function main(): number {
  const dir = resolve('src/core/fixtures');
  const files: [string, FixtureFile][] = [
    ['mobile-1.json', generate(MOBILE1, MOBILE_RUNS)],
    ['vr-1.json', generate(VR1, VR_RUNS)],
  ];
  for (const [name, file] of files) writeFileSync(resolve(dir, name), format(file));
  console.log(`wrote ${files.map(([n]) => n).join(', ')} to ${dir}`);
  return 0;
}
