import { describe, expect, it } from 'vitest';
import { bestStorageKey, dayKey, parseBest } from './best';
import {
  CFG,
  type Config,
  configFor,
  DEFAULT_MODE,
  gapForScore,
  isMode,
  MODES,
  PRESETS,
  parseUrl,
  speedForScore,
} from './config';
import { Game } from './game';
import { InputBus } from './input';
import { ObstacleField, POOL_SIZE } from './obstacles';
import { circleVsRect, flap, integrate } from './physics';

const cfg = (over: Partial<Config> = {}): Config => ({ ...CFG, ...over });
/** Always returns the same value: gap centred at (2v-1)·limit. */
const fixed = (v: number) => () => v;
/** Small deterministic PRNG (mulberry32). */
function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Step a game by n fixed steps. */
function run(game: Game, n: number) {
  for (let i = 0; i < n; i++) game.step(game.cfg.step);
}

describe('config', () => {
  it('has the spec starting constants', () => {
    expect(CFG.gravity).toBe(-5.5);
    expect(CFG.flapVelocity).toBe(2.1);
    expect(CFG.maxFall).toBe(-3.5);
    expect(CFG.birdRadius).toBe(0.12);
    expect(CFG.laneW).toBe(2.8);
    expect(CFG.laneH).toBe(1.6);
    expect(CFG.step).toBeCloseTo(1 / 120);
    expect(CFG.softBounds).toBe(false);
    expect(Object.isFrozen(CFG)).toBe(true);
  });

  it('applies URL overrides for g, flap, gap, speed, dist, h', () => {
    const { overrides, applied } = parseUrl('?g=-4&flap=2.5&gap=0.8&speed=1.3&dist=2&h=-0.2');
    const c = configFor('hard', overrides);
    expect(c.gravity).toBe(-4);
    expect(c.flapVelocity).toBe(2.5);
    expect(c.gapStart).toBe(0.8);
    expect(c.speedStart).toBe(1.3);
    expect(c.rigDistance).toBe(2);
    expect(c.rigHeight).toBe(-0.2);
    expect(applied.sort()).toEqual(['dist', 'flap', 'g', 'gap', 'h', 'speed']);
  });

  it('ignores invalid, empty and out-of-range values', () => {
    const { overrides, applied } = parseUrl('?g=abc&flap=&gap=5&speed=-1&dist=NaN&h=0.1');
    expect(overrides).toEqual({ rigHeight: 0.1 });
    expect(applied).toEqual(['h']);
  });

  it('keeps the difficulty curve valid when the start is overridden', () => {
    expect(configFor('hard', parseUrl('?gap=0.4').overrides).gapMin).toBe(0.4);
    expect(configFor('hard', parseUrl('?speed=2').overrides).speedMax).toBe(2);
  });

  it('reads debug, model, fx and mute flags', () => {
    expect(parseUrl('').flags).toEqual({ debug: false, model: 'joud', fx: true, mute: false });
    expect(parseUrl('?debug=1&model=placeholder&fx=0&mute=1').flags).toEqual({
      debug: true,
      model: 'placeholder',
      fx: false,
      mute: true,
    });
    expect(parseUrl('?model=other&fx=1&mute=0').flags).toEqual({
      debug: false,
      model: 'joud',
      fx: true,
      mute: false,
    });
  });

  it('does not mutate the base config or the presets', () => {
    configFor('easy', parseUrl('?g=-9&gap=0.9').overrides);
    expect(CFG.gravity).toBe(-5.5);
    expect(PRESETS.easy.gapStart).toBe(1.0);
  });

  it('shrinks the gap and raises the speed with score, up to the caps', () => {
    expect(gapForScore(0, CFG)).toBeCloseTo(0.7);
    expect(gapForScore(10, CFG)).toBeCloseTo(0.6);
    expect(gapForScore(100, CFG)).toBe(CFG.gapMin);
    expect(speedForScore(0, CFG)).toBeCloseTo(1.1);
    expect(speedForScore(10, CFG)).toBeCloseTo(1.3);
    expect(speedForScore(100, CFG)).toBe(CFG.speedMax);
  });
});

describe('difficulty modes', () => {
  it('lists three modes with normal as the default', () => {
    expect(MODES).toEqual(['easy', 'normal', 'hard']);
    expect(DEFAULT_MODE).toBe('normal');
    expect(parseUrl('').mode).toBe('normal');
    expect(isMode('easy')).toBe(true);
    expect(isMode('EASY')).toBe(false);
  });

  it('?mode= sets the default; unknown values fall back to normal', () => {
    expect(parseUrl('?mode=easy').mode).toBe('easy');
    expect(parseUrl('?mode=hard').mode).toBe('hard');
    expect(parseUrl('?mode=insane').mode).toBe('normal');
    expect(parseUrl('?mode=easy').applied).toContain('mode');
  });

  it('easy: flap 1.7, fixed gap 1.00, fixed speed 0.9, spacing 1.6, soft bounds, no ramp', () => {
    const c = configFor('easy');
    expect(c.flapVelocity).toBe(1.7);
    expect(c.spacing).toBe(1.6);
    expect(c.softBounds).toBe(true);
    for (const score of [0, 10, 100]) {
      expect(gapForScore(score, c)).toBe(1.0);
      expect(speedForScore(score, c)).toBe(0.9);
    }
  });

  it('normal: flap 1.9, gap 0.85 → 0.65, speed 1.0 → 1.3, hard bounds', () => {
    const c = configFor('normal');
    expect(c.flapVelocity).toBe(1.9);
    expect(c.spacing).toBe(CFG.spacing);
    expect(c.softBounds).toBe(false);
    expect(gapForScore(0, c)).toBe(0.85);
    expect(gapForScore(100, c)).toBe(0.65);
    expect(speedForScore(0, c)).toBe(1.0);
    expect(speedForScore(100, c)).toBe(1.3);
    expect(gapForScore(10, c)).toBeCloseTo(0.75);
  });

  it('hard: the original spec values', () => {
    const c = configFor('hard');
    expect(c).toEqual({ ...CFG });
    expect(c.flapVelocity).toBe(2.1);
    expect(gapForScore(0, c)).toBe(0.7);
    expect(gapForScore(100, c)).toBe(0.52);
    expect(speedForScore(0, c)).toBe(1.1);
    expect(speedForScore(100, c)).toBe(1.5);
  });

  it('URL overrides win over every preset', () => {
    const { overrides } = parseUrl('?flap=2.4&gap=0.9&speed=1.2&g=-4');
    for (const m of MODES) {
      const c = configFor(m, overrides);
      expect(c.flapVelocity).toBe(2.4);
      expect(c.gapStart).toBe(0.9);
      expect(c.speedStart).toBe(1.2);
      expect(c.gravity).toBe(-4);
    }
    // easy stays ramp-free: the overridden gap and speed hold for every score
    const easy = configFor('easy', overrides);
    expect(gapForScore(50, easy)).toBe(0.9);
    expect(speedForScore(50, easy)).toBe(1.2);
  });
});

describe('physics', () => {
  it('applies gravity to velocity, then velocity to position', () => {
    const b = { y: 0, vy: 0 };
    integrate(b, 0.1, CFG);
    expect(b.vy).toBeCloseTo(-0.55);
    expect(b.y).toBeCloseTo(-0.055);
  });

  it('clamps the fall speed at maxFall', () => {
    const b = { y: 0, vy: -3.4 };
    integrate(b, 1, CFG);
    expect(b.vy).toBe(CFG.maxFall);
  });

  it('a flap sets vy instead of adding to it', () => {
    const b = { y: 0, vy: 1.5 };
    flap(b, CFG);
    expect(b.vy).toBe(CFG.flapVelocity);
    b.vy = -3;
    flap(b, CFG);
    expect(b.vy).toBe(CFG.flapVelocity);
  });

  it('circleVsRect: inside, edge, corner and miss', () => {
    // centre inside
    expect(circleVsRect(0, 0, 0.1, -1, -1, 1, 1)).toBe(true);
    // side: distance 0.1 from the edge, radius 0.12 → hit; radius 0.09 → miss
    expect(circleVsRect(1.1, 0, 0.12, -1, -1, 1, 1)).toBe(true);
    expect(circleVsRect(1.1, 0, 0.09, -1, -1, 1, 1)).toBe(false);
    // touching counts
    expect(circleVsRect(1.5, 0, 0.5, -1, -1, 1, 1)).toBe(true); // exact in binary
    // corner: (1.1, 1.1) is √0.02 ≈ 0.1414 from (1, 1)
    expect(circleVsRect(1.1, 1.1, 0.14, -1, -1, 1, 1)).toBe(false);
    expect(circleVsRect(1.1, 1.1, 0.15, -1, -1, 1, 1)).toBe(true);
  });
});

describe('obstacles', () => {
  it('spawns the first pair just outside the left edge on the first update', () => {
    const f = new ObstacleField(CFG);
    expect(f.activeCount()).toBe(0);
    f.update(0, 1.1, 0.7, fixed(0.5));
    expect(f.activeCount()).toBe(1);
    const o = f.pool.find((p) => p.active)!;
    expect(o.x).toBeCloseTo(-CFG.laneW / 2 - CFG.pipeWidth / 2);
    expect(o.gap).toBe(0.7);
    expect(o.gapY).toBeCloseTo(0);
  });

  it('moves obstacles right and spawns one every `spacing` metres', () => {
    const f = new ObstacleField(CFG);
    f.update(0, 1, 0.7, fixed(0.5));
    f.update(CFG.spacing - 0.01, 1, 0.7, fixed(0.5));
    expect(f.activeCount()).toBe(1);
    f.update(0.01, 1, 0.7, fixed(0.5));
    expect(f.activeCount()).toBe(2);
    const xs = f.pool.filter((p) => p.active).map((p) => p.x).sort((a, b) => a - b);
    expect(xs[1] - xs[0]).toBeCloseTo(CFG.spacing);
  });

  it('recycles pairs that leave the lane and never needs more than the pool', () => {
    const f = new ObstacleField(CFG);
    const objects = new Set(f.pool);
    const dt = 1 / 120;
    for (let i = 0; i < 120 * 60; i++) {
      f.update(dt, 1.5, 0.6, fixed(0.3));
      expect(f.activeCount()).toBeLessThanOrEqual(POOL_SIZE);
      for (const o of f.pool) if (o.active) expect(o.x).toBeLessThan(f.despawnX);
    }
    expect(f.pool.length).toBe(POOL_SIZE);
    for (const o of f.pool) expect(objects.has(o)).toBe(true);
  });

  it('scores once when the bird passes the trailing edge', () => {
    const f = new ObstacleField(cfg({ spacing: 100 }));
    f.update(0, 1, 0.7, fixed(0.5));
    const o = f.pool.find((p) => p.active)!;
    const toEdge = CFG.birdX + CFG.pipeWidth / 2 - o.x; // distance until trailing edge passes birdX
    expect(f.update(toEdge - 0.001, 1, 0.7, fixed(0.5))).toBe(0);
    expect(f.update(0.002, 1, 0.7, fixed(0.5))).toBe(1);
    expect(f.update(0.1, 1, 0.7, fixed(0.5))).toBe(0);
  });

  it('keeps gaps inside the lane and close to the previous gap', () => {
    const f = new ObstacleField(CFG);
    const rng = seeded(42);
    const limit = CFG.laneH / 2 - CFG.gapMargin - 0.7 / 2;
    let prev: number | null = null;
    for (let i = 0; i < 40; i++) {
      f.update(CFG.spacing, 1, 0.7, rng);
      const newest = f.pool.reduce((a, b) => (b.active && b.x < a.x ? b : a));
      expect(Math.abs(newest.gapY)).toBeLessThanOrEqual(limit + 1e-9);
      if (prev !== null) expect(Math.abs(newest.gapY - prev)).toBeLessThanOrEqual(CFG.maxGapShift + 1e-9);
      prev = newest.gapY;
    }
  });

  it('hits the top and bottom blocks but not the gap', () => {
    const f = new ObstacleField(CFG);
    f.update(0, 1, 0.7, fixed(0.5)); // gap centred at y=0, from -0.35 to 0.35
    const o = f.pool.find((p) => p.active)!;
    o.x = 0;
    expect(f.hits(0, 0, 0.12)).toBe(false);
    expect(f.hits(0, 0.3, 0.12)).toBe(true); // top edge at 0.35
    expect(f.hits(0, -0.3, 0.12)).toBe(true);
    expect(f.hits(0.5, 0.6, 0.12)).toBe(false); // beside the block
  });

  it('reset deactivates everything', () => {
    const f = new ObstacleField(CFG);
    f.update(CFG.spacing * 2, 1, 0.7, fixed(0.5));
    f.reset();
    expect(f.activeCount()).toBe(0);
  });
});

describe('input bus', () => {
  it('drains commands in order and empties the queue', () => {
    const bus = new InputBus();
    bus.push('start');
    bus.push('flap');
    bus.push('pause');
    const seen: string[] = [];
    bus.drain((c) => seen.push(c));
    expect(seen).toEqual(['start', 'flap', 'pause']);
    expect(bus.size).toBe(0);
    expect(bus.last).toBe('pause');
  });
});

describe('game state machine', () => {
  const newGame = (over: Partial<Config> = {}) => new Game(cfg(over), { rng: fixed(0.5) });

  it('starts in attract; flap or start goes to ready', () => {
    const g = newGame();
    expect(g.state).toBe('attract');
    g.handle('flap');
    expect(g.state).toBe('ready');
    const g2 = newGame();
    g2.handle('start');
    expect(g2.state).toBe('ready');
  });

  it('ready holds the bird still until the first flap', () => {
    const g = newGame();
    g.handle('start');
    run(g, 240);
    expect(g.bird.y).toBe(0);
    expect(g.field.activeCount()).toBe(0);
    g.handle('flap');
    expect(g.state).toBe('playing');
    expect(g.bird.vy).toBe(CFG.flapVelocity);
    expect(g.events).toContain('flap');
  });

  it('falling to the floor ends the round', () => {
    const g = newGame();
    g.handle('start');
    g.handle('flap');
    run(g, 120 * 3);
    expect(g.state).toBe('gameOver');
    expect(g.events).toContain('hit');
    expect(g.bird.y - CFG.birdRadius).toBeLessThanOrEqual(-CFG.laneH / 2 + 0.05);
  });

  it('flying into the ceiling ends the round', () => {
    const g = newGame({ gravity: -0.5 });
    g.handle('start');
    g.handle('flap');
    run(g, 120 * 2);
    expect(g.state).toBe('gameOver');
  });

  it('hitting an obstacle ends the round', () => {
    // Bird hovers at y=0.5 (no gravity, no flap speed): the gap is at y=0, so the top block hits.
    const g = newGame({ gravity: -0.0001, flapVelocity: 0 });
    g.handle('start');
    g.handle('flap');
    g.bird.y = 0.5;
    run(g, 120 * 4);
    expect(g.state).toBe('gameOver');
    expect(g.score).toBe(0);
  });

  it('scores through gaps, raises best and flags a new best', () => {
    // Bird holds y=0 (no gravity) and the gaps are centred at y=0: it scores forever.
    const g = new Game(cfg({ gravity: -0.0001, flapVelocity: 0 }), { rng: fixed(0.5), best: 2 });
    g.handle('start');
    g.handle('flap');
    run(g, 120 * 8);
    expect(g.state).toBe('playing');
    expect(g.score).toBeGreaterThanOrEqual(3);
    expect(g.best).toBe(2); // best only updates at game over
    g.bird.y = -1; // force a floor hit
    run(g, 1);
    expect(g.state).toBe('gameOver');
    expect(g.best).toBe(g.score);
    expect(g.newBest).toBe(true);
    expect(g.events).toContain('newBest');
  });

  it('does not flag a new best when the score is lower', () => {
    const g = new Game(CFG, { rng: fixed(0.5), best: 50 });
    g.handle('start');
    g.handle('flap');
    run(g, 120 * 3);
    expect(g.state).toBe('gameOver');
    expect(g.best).toBe(50);
    expect(g.newBest).toBe(false);
  });

  it('trigger restart is locked out for 0.8 s after game over; restart is not', () => {
    const g = newGame();
    g.handle('start');
    g.handle('flap');
    run(g, 120 * 3);
    expect(g.state).toBe('gameOver');
    g.stateTime = 0;
    run(g, Math.floor(0.79 * 120));
    g.handle('flap');
    expect(g.state).toBe('gameOver');
    run(g, 3);
    expect(g.canRestartWithTrigger).toBe(true);
    g.handle('flap');
    expect(g.state).toBe('ready');
    expect(g.score).toBe(0);
    expect(g.bird.y).toBe(0);

    const g2 = newGame();
    g2.handle('start');
    g2.handle('flap');
    run(g2, 120 * 3);
    g2.stateTime = 0;
    g2.handle('restart');
    expect(g2.state).toBe('ready');
  });

  it('restart does nothing mid-round (no accidental A/X restarts)', () => {
    const g = newGame();
    g.handle('start');
    g.handle('flap');
    g.handle('restart');
    expect(g.state).toBe('playing');
  });

  it('pause freezes the simulation and toggles back', () => {
    const g = newGame();
    g.handle('start');
    g.handle('flap');
    run(g, 10);
    g.handle('pause');
    expect(g.state).toBe('paused');
    const y = g.bird.y;
    const xs = g.field.pool.map((o) => o.x);
    run(g, 120);
    expect(g.bird.y).toBe(y);
    expect(g.field.pool.map((o) => o.x)).toEqual(xs);
    g.handle('pause');
    expect(g.state).toBe('playing');
  });

  it('flap resumes from pause with a flap; restart from pause goes to ready', () => {
    const g = newGame();
    g.handle('start');
    g.handle('flap');
    g.handle('pause');
    g.bird.vy = -1;
    g.handle('flap');
    expect(g.state).toBe('playing');
    expect(g.bird.vy).toBe(CFG.flapVelocity);
    g.handle('pause');
    g.handle('restart');
    expect(g.state).toBe('ready');
  });

  it('pausing in ready resumes to ready', () => {
    const g = newGame();
    g.handle('start');
    g.handle('pause');
    g.handle('pause');
    expect(g.state).toBe('ready');
  });

  it('suspend pauses only an active round and is not a toggle', () => {
    const g = newGame();
    g.suspend();
    expect(g.state).toBe('attract');
    g.handle('start');
    g.handle('flap');
    g.suspend();
    g.suspend();
    expect(g.state).toBe('paused');
  });

  it('toAttract resets the round from any state', () => {
    const g = newGame();
    g.handle('start');
    g.handle('flap');
    run(g, 60);
    g.toAttract();
    expect(g.state).toBe('attract');
    expect(g.score).toBe(0);
    expect(g.bird.y).toBe(0);
    expect(g.field.activeCount()).toBe(0);
  });

  it('advance runs fixed steps, carries the remainder and clamps hitches', () => {
    const g = newGame();
    expect(g.advance(1 / 60)).toBe(2);
    expect(g.advance(1 / 240)).toBe(0);
    expect(g.advance(1 / 240)).toBe(1);
    expect(g.advance(5)).toBe(12); // clamped to 0.1 s
    expect(g.advance(0)).toBe(0);
    expect(g.advance(Number.NaN)).toBe(0);
    expect(g.advance(-1)).toBe(0);
  });

  it('is frame-rate independent', () => {
    const play = (frame: number) => {
      const g = newGame();
      g.handle('start');
      g.handle('flap');
      for (let t = 0; t < 0.5; t += frame) g.advance(frame);
      return g.bird.y;
    };
    expect(play(1 / 72)).toBeCloseTo(play(1 / 90), 1);
  });

  it('records a state event on every transition', () => {
    const g = newGame();
    g.handle('start');
    g.handle('flap');
    expect(g.events.filter((e) => e === 'state').length).toBe(2);
  });
});

describe('game with difficulty modes', () => {
  it('easy: the floor bounces the bird instead of ending the round', () => {
    const g = new Game(configFor('easy'), { rng: fixed(0.5), mode: 'easy' });
    g.handle('start');
    g.handle('flap');
    let bounced = false;
    // 1.9 s: the bird hits the floor at ~0.9 s; the first pair reaches it at ~2.1 s.
    for (let i = 0; i < 228; i++) {
      g.step(g.cfg.step);
      if (g.events.includes('bounce')) bounced = true;
      g.events.length = 0;
      expect(g.bird.y - g.cfg.birdRadius).toBeGreaterThanOrEqual(-g.cfg.laneH / 2 - 1e-9);
    }
    expect(bounced).toBe(true);
    expect(g.state).toBe('playing');
  });

  it('easy: the ceiling stops the climb instead of ending the round', () => {
    const g = new Game(configFor('easy', { gravity: -0.5 }), { rng: fixed(0.5), mode: 'easy' });
    g.handle('start');
    g.handle('flap');
    run(g, 120 * 2);
    expect(g.state).toBe('playing');
    expect(g.bird.y + g.cfg.birdRadius).toBeLessThanOrEqual(g.cfg.laneH / 2 + 1e-9);
  });

  it('easy: obstacles still end the round', () => {
    const g = new Game(configFor('easy', { gravity: -0.0001, flapVelocity: 0 }), {
      rng: fixed(0.5),
      mode: 'easy',
    });
    g.handle('start');
    g.handle('flap');
    g.bird.y = 0.6; // above the 1.0 m gap centred at 0 (top edge at 0.5)
    run(g, 120 * 5);
    expect(g.state).toBe('gameOver');
  });

  it('normal and hard: floor still ends the round', () => {
    for (const m of ['normal', 'hard'] as const) {
      const g = new Game(configFor(m), { rng: fixed(0.5), mode: m });
      g.handle('start');
      g.handle('flap');
      run(g, 120 * 3);
      expect(g.state).toBe('gameOver');
    }
  });

  it('easy scores through its wide gaps at the slower speed', () => {
    const g = new Game(configFor('easy', { gravity: -0.0001, flapVelocity: 0 }), {
      rng: fixed(0.5),
      mode: 'easy',
    });
    g.handle('start');
    g.handle('flap');
    run(g, 120 * 10);
    expect(g.state).toBe('playing');
    // 10 s at 0.9 m/s with 1.6 m spacing; the first pair needs ~2.4 m to pass the bird.
    expect(g.score).toBeGreaterThanOrEqual(3);
    expect(g.speed).toBe(0.9);
    expect(g.gap).toBe(1.0);
  });

  it('configure switches mode, config and best only on the attract screen', () => {
    const g = new Game(configFor('normal'), { rng: fixed(0.5), best: 4, mode: 'normal' });
    expect(g.mode).toBe('normal');
    expect(g.configure(configFor('easy'), 'easy', 9)).toBe(true);
    expect(g.mode).toBe('easy');
    expect(g.best).toBe(9);
    expect(g.cfg.softBounds).toBe(true);
    expect(g.events).toContain('mode');
    expect(g.state).toBe('attract');

    g.handle('start');
    expect(g.configure(configFor('hard'), 'hard', 1)).toBe(false);
    expect(g.mode).toBe('easy');
    g.handle('flap');
    run(g, 120 * 3);
    expect(g.configure(configFor('hard'), 'hard', 1)).toBe(false);

    g.toAttract();
    expect(g.configure(configFor('hard'), 'hard', 1)).toBe(true);
    expect(g.cfg.flapVelocity).toBe(2.1);
    expect(g.field.activeCount()).toBe(0);
  });
});

describe('best of the day', () => {
  it('builds a per-day storage key', () => {
    const d = new Date(2026, 10, 17, 16, 0);
    expect(dayKey(d)).toBe('2026-11-17');
    expect(bestStorageKey(d, 'easy')).toBe('joudbird.best.easy.2026-11-17');
    expect(bestStorageKey(d, 'hard')).toBe('joudbird.best.hard.2026-11-17');
  });

  it('parses stored values defensively', () => {
    expect(parseBest('12')).toBe(12);
    expect(parseBest(null)).toBe(0);
    expect(parseBest('')).toBe(0);
    expect(parseBest('-3')).toBe(0);
    expect(parseBest('1.5')).toBe(0);
    expect(parseBest('abc')).toBe(0);
  });
});
