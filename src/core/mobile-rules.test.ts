// Rules of mobile-1 (obstacle kinds, points, course) and the seeded RNG, recorder and replay API.
import { describe, expect, it } from 'vitest';
import { CFG, configFor, MODES } from './config';
import { Game } from './game';
import { ObstacleField, type Obstacle } from './obstacles';
import { replay, validateLog } from './replay';
import { isSeed, mixSeed, Prng } from './rng';
import {
  impactPoints,
  KINDS,
  MAX_TICKS,
  maxPoints,
  MOBILE1,
  type ObstacleKind,
  VR1,
} from './ruleset';

/** Reference mulberry32, written independently. */
function reference(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('seeded rng', () => {
  it('matches mulberry32 and stays in [0, 1)', () => {
    for (const seed of [0, 1, 42, 0xffffffff, 123456789]) {
      const p = new Prng(seed);
      const ref = reference(seed | 0);
      for (let i = 0; i < 1000; i++) {
        const v = p.next();
        expect(v).toBe(ref());
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });

  it('known values for seed 1 (pinned across engines)', () => {
    const p = new Prng(1);
    expect([p.next(), p.next(), p.next()]).toEqual([
      0.6270739405881613, 0.002735721180215478, 0.5274470399599522,
    ]);
  });

  it('validates and mixes seeds', () => {
    expect(isSeed(0)).toBe(true);
    expect(isSeed(0xffffffff)).toBe(true);
    expect(isSeed(-1)).toBe(false);
    expect(isSeed(2 ** 32)).toBe(false);
    expect(isSeed(1.5)).toBe(false);
    expect(isSeed('1')).toBe(false);
    expect(mixSeed(1)).not.toBe(1);
    expect(isSeed(mixSeed(0xffffffff))).toBe(true);
  });
});

describe('rulesets', () => {
  it('vr-1 is today’s VR game', () => {
    expect(VR1.step).toBe(1 / 120);
    for (const m of MODES) expect(VR1.modes[m]).toEqual(configFor(m));
    expect(VR1.points.gate).toBe(1);
    for (const m of MODES) {
      const c = VR1.course[m];
      expect(c.flowerChance).toBe(0);
      for (const k of KINDS) if (k !== 'gate') expect(c.start[k] + c.end[k]).toBe(0);
    }
  });

  it('mobile-1: 60 Hz, portrait lane, about 2.5 obstacles visible ahead', () => {
    expect(MOBILE1.step).toBe(1 / 60);
    expect(MOBILE1.maxTicks).toBe(MAX_TICKS);
    expect(MAX_TICKS).toBe(60 * 60 * 15);
    for (const m of MODES) {
      const c = MOBILE1.modes[m];
      expect(c.laneH).toBeGreaterThan(c.laneW);
      const ahead = (c.birdX + c.laneW / 2) / c.spacing;
      expect(ahead).toBeGreaterThan(2.1);
      expect(ahead).toBeLessThan(2.8);
      expect(MOBILE1.kinds.stairsStep).toBeLessThanOrEqual(c.maxGapShift);
    }
    expect(MOBILE1.modes.easy.softBounds).toBe(true);
    expect(MOBILE1.modes.normal.softBounds).toBe(false);
    expect(MOBILE1.modes.hard.softBounds).toBe(false);
  });

  it('mobile-1 points table and mode multipliers', () => {
    expect(MOBILE1.points).toEqual({
      gate: 1,
      stairs: 2,
      updraft: 2,
      narrow: 3,
      moving: 3,
      forkSafe: 1,
      forkRisky: 5,
      flower: 1,
    });
    expect(impactPoints(10, 'easy', MOBILE1)).toBe(10);
    expect(impactPoints(10, 'normal', MOBILE1)).toBe(20);
    expect(impactPoints(10, 'hard', MOBILE1)).toBe(30);
  });

  it('easy draws only gate, stairs, updraft and fork', () => {
    const c = MOBILE1.course.easy;
    expect(c.start.narrow + c.end.narrow + c.start.moving + c.end.moving).toBe(0);
    for (const m of ['normal', 'hard'] as const) {
      for (const k of KINDS) expect(MOBILE1.course[m].end[k]).toBeGreaterThan(0);
    }
  });
});

interface Spawned {
  kind: ObstacleKind;
  ref: number;
  o: Obstacle;
}

/** Run a field with no bird in the way and record each spawn in order. */
function course(mode: 'easy' | 'normal' | 'hard', seed: number, count: number): Spawned[] {
  const cfg = MOBILE1.modes[mode];
  const f = new ObstacleField(cfg, MOBILE1, mode);
  const p = new Prng(seed);
  const rng = () => p.next();
  const out: Spawned[] = [];
  const seen = new Set<Obstacle>();
  let guard = 0;
  while (out.length < count && guard++ < 1e6) {
    for (const o of f.pool) if (!o.active) seen.delete(o);
    f.update(cfg.step, cfg.speedStart, cfg.gapStart, rng, 5);
    for (const o of f.pool) {
      if (o.active && !seen.has(o)) {
        seen.add(o);
        let ref = o.gapY;
        if (o.kind === 'moving') ref = o.baseY;
        if (o.kind === 'fork') {
          const top = Math.max(o.gapY + o.gap / 2, o.gap2Y + o.gap2 / 2);
          const bottom = Math.min(o.gapY - o.gap / 2, o.gap2Y - o.gap2 / 2);
          ref = (top + bottom) / 2;
        }
        out.push({ kind: o.kind, ref, o: { ...o } });
      }
    }
  }
  return out;
}

describe('course', () => {
  for (const mode of MODES) {
    it(`${mode}: reachable, inside the lane, and no two big kinds back to back`, () => {
      const cfg = MOBILE1.modes[mode];
      const top = cfg.laneH / 2 - cfg.gapMargin + 1e-9;
      for (let seed = 1; seed <= 20; seed++) {
        const list = course(mode, seed, 120);
        for (let i = 0; i < list.length; i++) {
          const { kind, ref, o } = list[i];
          if (mode === 'easy') expect(['gate', 'stairs', 'updraft', 'fork']).toContain(kind);
          if (i > 0) {
            expect(Math.abs(ref - list[i - 1].ref)).toBeLessThanOrEqual(cfg.maxGapShift + 1e-9);
            const prevBig = maxPoints(list[i - 1].kind, MOBILE1.points) >= 3;
            if (prevBig) expect(kind).toBe('gate');
          }
          const swing = o.moveAmp;
          expect(o.gapY + o.gap / 2 + swing).toBeLessThanOrEqual(top);
          expect(o.gapY - o.gap / 2 - swing).toBeGreaterThanOrEqual(-top);
          if (o.gap2 > 0) {
            expect(o.gap2).toBeLessThan(o.gap);
            expect(o.gap2Y + o.gap2 / 2).toBeLessThanOrEqual(top);
            expect(o.gap2Y - o.gap2 / 2).toBeGreaterThanOrEqual(-top);
          }
          if (kind === 'narrow') expect(o.gap).toBeLessThan(cfg.gapStart);
        }
      }
    });
  }

  it('stairs come in threes that step the same way by a fixed amount', () => {
    let found = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const list = course('normal', seed, 120);
      for (let i = 0; i + 2 < list.length; i++) {
        if (list[i].kind !== 'stairs' || (i > 0 && list[i - 1].kind === 'stairs')) continue;
        expect(list[i + 1].kind).toBe('stairs');
        expect(list[i + 2].kind).toBe('stairs');
        const d1 = list[i + 1].ref - list[i].ref;
        const d2 = list[i + 2].ref - list[i + 1].ref;
        expect(Math.abs(d1)).toBeCloseTo(MOBILE1.kinds.stairsStep, 9);
        expect(d2).toBeCloseTo(d1, 9);
        found++;
        i += 2;
      }
    }
    expect(found).toBeGreaterThan(10);
  });

  it('every kind and both fork sides appear; flowers sit in gaps', () => {
    const kinds = new Set<string>();
    let top = 0;
    let bottom = 0;
    let flowers = 0;
    for (let seed = 1; seed <= 20; seed++) {
      for (const { kind, o } of course('hard', seed, 120)) {
        kinds.add(kind);
        if (kind === 'fork') o.gap2Y > o.gapY ? top++ : bottom++;
        if (o.flower === 1) {
          flowers++;
          expect(kind).not.toBe('moving');
          expect(o.flowerY).toBe(kind === 'fork' ? o.gap2Y : o.gapY);
        }
      }
    }
    expect([...kinds].sort()).toEqual([...KINDS].sort());
    expect(top).toBeGreaterThan(0);
    expect(bottom).toBeGreaterThan(0);
    expect(flowers).toBeGreaterThan(0);
  });

  it('vr-1 draws one random number per obstacle, as before', () => {
    const f = new ObstacleField(CFG);
    let calls = 0;
    const rng = () => {
      calls++;
      return 0.25;
    };
    for (let i = 0; i < 10; i++) f.update(CFG.spacing, 1, 0.7, rng);
    expect(calls).toBe(10);
  });
});

/** A single active obstacle placed by hand. */
function only(f: ObstacleField, set: Partial<Obstacle>): Obstacle {
  f.reset();
  const o = f.pool[0];
  Object.assign(o, {
    active: true,
    scored: false,
    kind: 'gate',
    points: 1,
    gap2: 0,
    gap2Y: 0,
    moveAmp: 0,
    updraft: 0,
    flower: 0,
    forkSide: 0,
    ...set,
  });
  return o;
}

describe('obstacle kinds', () => {
  const cfg = MOBILE1.modes.normal;
  const huge = { ...cfg, spacing: 100 }; // no new spawns
  const zero = () => 0;

  it('a fork pays by the gap the bird used: safe 1, risky 5', () => {
    const f = new ObstacleField(huge, MOBILE1, 'normal');
    const setup = () =>
      only(f, { kind: 'fork', x: cfg.birdX, gapY: -0.2, gap: 0.3, gap2Y: 0.2, gap2: 0.18 });
    setup();
    expect(f.update(0.1, 1, 0.3, zero, -0.2)).toBe(1);
    expect(f.forkSafe).toBe(1);
    setup();
    expect(f.update(0.1, 1, 0.3, zero, 0.2)).toBe(5);
    expect(f.forkRisky).toBe(1);
  });

  it('a fork has a middle block between its gaps', () => {
    const f = new ObstacleField(huge, MOBILE1, 'normal');
    only(f, { kind: 'fork', x: 0, gapY: -0.2, gap: 0.3, gap2Y: 0.2, gap2: 0.18 });
    expect(f.hits(0, -0.2, 0.04)).toBe(false);
    expect(f.hits(0, 0.2, 0.04)).toBe(false);
    expect(f.hits(0, 0.0, 0.04)).toBe(true);
    expect(f.hits(0, 0.4, 0.04)).toBe(true);
    expect(f.hits(0, -0.45, 0.04)).toBe(true);
  });

  it('kinds pay their table points when passed', () => {
    const f = new ObstacleField(huge, MOBILE1, 'normal');
    for (const kind of ['gate', 'stairs', 'updraft', 'narrow', 'moving'] as const) {
      only(f, { kind, points: MOBILE1.points[kind], x: cfg.birdX, gapY: 0, gap: 0.3 });
      expect(f.update(0.1, 1, 0.3, zero, 0)).toBe(MOBILE1.points[kind]);
    }
  });

  it('a flower is collected once on circle overlap', () => {
    const f = new ObstacleField(huge, MOBILE1, 'normal');
    only(f, { x: cfg.birdX - 0.2, gapY: 0, gap: 0.3, flower: 1, flowerY: 0.05 });
    f.update(0.1, 1, 0.3, zero, 0.05); // x moves 0.1: still 0.1 away
    expect(f.flowersGot).toBe(0);
    f.update(0.1, 1, 0.3, zero, 0.05); // on the bird
    expect(f.flowersGot).toBe(1);
    f.update(0.01, 1, 0.3, zero, 0.05);
    expect(f.flowersGot).toBe(0);
    expect(f.flowersTaken).toBe(1);
  });

  it('an updraft lifts only inside its column in front of the gate', () => {
    const f = new ObstacleField(huge, MOBILE1, 'normal');
    const o = only(f, { kind: 'updraft', x: 0, gapY: 0, gap: 0.3, updraft: 0.2 });
    const lead = o.x + cfg.pipeWidth / 2;
    expect(f.liftAt(lead - 0.01)).toBe(0);
    expect(f.liftAt(lead + 0.1)).toBe(MOBILE1.kinds.updraftLift);
    expect(f.liftAt(lead + 0.21)).toBe(0);
  });

  it('a moving gap ping-pongs linearly within its amplitude', () => {
    const f = new ObstacleField(huge, MOBILE1, 'normal');
    const amp = MOBILE1.kinds.movingAmplitude;
    const o = only(f, { kind: 'moving', x: -10, baseY: 0.1, gapY: 0.1, moveY: 0, moveDir: 1, moveAmp: amp, gap: 0.3 });
    const dt = 1 / 60;
    let prev = o.gapY;
    let turns = 0;
    let lastDir = 1;
    for (let i = 0; i < 600; i++) {
      f.update(dt, 0, 0.3, zero, 5);
      expect(Math.abs(o.gapY - 0.1)).toBeLessThanOrEqual(amp + 1e-12);
      const step = Math.abs(o.gapY - prev);
      expect(step).toBeLessThanOrEqual(MOBILE1.kinds.movingSpeed * dt + 1e-12);
      if (o.moveDir !== lastDir) turns++;
      lastDir = o.moveDir;
      prev = o.gapY;
    }
    expect(turns).toBeGreaterThan(2);
  });
});

describe('recorder and seeds', () => {
  const rs = MOBILE1;
  const newGame = (seed = 7) => new Game(rs.modes.normal, { ruleset: rs, mode: 'normal', seed });

  it('records tick 0 for the starting flap and drops duplicates within a tick', () => {
    const g = newGame();
    g.handle('start');
    g.handle('flap');
    g.handle('flap');
    g.step(rs.step);
    g.step(rs.step);
    g.handle('flap');
    g.handle('flap');
    g.bird.y = -5; // floor
    g.step(rs.step);
    expect(g.state).toBe('gameOver');
    expect(g.lastRun).toEqual({ rulesetId: 'mobile-1', mode: 'normal', seed: 7, flaps: [0, 2], endTick: 3 });
    expect(g.lastResult!.endReason).toBe('floor');
  });

  it('ticks advance only while playing', () => {
    const g = newGame();
    g.handle('start');
    g.advance(1);
    expect(g.tick).toBe(0);
    g.handle('flap');
    g.step(rs.step);
    g.handle('pause');
    for (let i = 0; i < 100; i++) g.step(rs.step);
    expect(g.tick).toBe(1);
  });

  it('a new round gets a new seed from nextSeed; a fresh game keeps its seed', () => {
    let n = 100;
    const g = new Game(rs.modes.normal, { ruleset: rs, mode: 'normal', seed: 5, nextSeed: () => n++ });
    g.handle('start');
    expect(g.seed).toBe(5);
    g.handle('flap');
    g.bird.y = -5;
    g.step(rs.step);
    g.handle('restart');
    expect(g.seed).toBe(100);
    const h = new Game(rs.modes.normal, { ruleset: rs, mode: 'normal', seed: 5 });
    h.handle('start');
    h.handle('flap');
    h.bird.y = -5;
    h.step(rs.step);
    h.handle('restart');
    expect(h.seed).toBe(mixSeed(5));
  });

  it('setSeed is refused during a round', () => {
    const g = newGame();
    expect(g.setSeed(9)).toBe(true);
    g.handle('start');
    expect(g.seed).toBe(9);
    g.handle('flap');
    expect(g.setSeed(10)).toBe(false);
    g.handle('pause');
    expect(g.setSeed(10)).toBe(false);
  });

  it('the same spec and flaps give the same result; another seed does not', () => {
    const play = (seed: number) => {
      const g = newGame(seed);
      g.handle('start');
      g.handle('flap');
      while (g.state === 'playing') {
        g.step(rs.step);
        if (g.state === 'playing' && g.tick % 22 === 0) g.handle('flap');
      }
      return g.lastResult!;
    };
    expect(play(3)).toEqual(play(3));
    expect(play(3).hash).not.toBe(play(4).hash);
  });
});

describe('replay validation', () => {
  const ok = { rulesetId: 'mobile-1', mode: 'normal' as const, seed: 1, flaps: [0, 20], endTick: 50 };

  it('returns reason codes and never throws', () => {
    const bad: [unknown, string][] = [
      [null, 'badLog'],
      ['x', 'badLog'],
      [{ ...ok, rulesetId: 'mobile-0' }, 'unknownRuleset'],
      [{ ...ok, rulesetId: '__proto__' }, 'unknownRuleset'],
      [{ ...ok, mode: 'insane' }, 'badMode'],
      [{ ...ok, seed: -1 }, 'badSeed'],
      [{ ...ok, seed: 1.5 }, 'badSeed'],
      [{ ...ok, endTick: 0 }, 'badEndTick'],
      [{ ...ok, endTick: MAX_TICKS + 1 }, 'endTickTooLarge'],
      [{ ...ok, flaps: [] }, 'noFlaps'],
      [{ ...ok, flaps: 'x' }, 'noFlaps'],
      [{ ...ok, flaps: [0, 1.5] }, 'badFlap'],
      [{ ...ok, flaps: [0, 20, 10] }, 'unsortedFlaps'],
      [{ ...ok, flaps: [0, 20, 20] }, 'duplicateFlap'],
      [{ ...ok, flaps: [3, 20] }, 'firstFlapNotZero'],
      [{ ...ok, flaps: [0, 50] }, 'flapAfterEnd'],
    ];
    for (const [log, reason] of bad) {
      expect(validateLog(log)).toBe(reason);
      const r = replay(log as never);
      expect(r.valid).toBe(false);
      expect(r.reason).toBe(reason);
      expect(r.score).toBe(0);
    }
    expect(validateLog(ok)).toBeNull();
  });

  it('stops at the log end while still flying, or at opts.maxTicks', () => {
    const flaps = [0];
    for (let t = 15; t < 300; t += 15) flaps.push(t);
    const easy = { rulesetId: 'mobile-1', mode: 'easy' as const, seed: 1, flaps, endTick: 300 };
    const r = replay(easy);
    expect(r.valid).toBe(true);
    if (r.endReason === 'logEnd') expect(r.endTick).toBe(300);
    const capped = replay(easy, { maxTicks: 40 });
    expect(capped.endTick).toBeLessThanOrEqual(40);
  });
});
