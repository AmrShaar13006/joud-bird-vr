import { describe, expect, it } from 'vitest';
import { bestStorageKey, dayKey, parseBest } from './best';
import { CFG, type Config, gapForScore, parseOverrides, speedForScore } from './config';
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
    expect(Object.isFrozen(CFG)).toBe(true);
  });

  it('applies URL overrides for g, flap, gap, speed, dist, h', () => {
    const { cfg: c, applied } = parseOverrides('?g=-4&flap=2.5&gap=0.8&speed=1.3&dist=2&h=-0.2');
    expect(c.gravity).toBe(-4);
    expect(c.flapVelocity).toBe(2.5);
    expect(c.gapStart).toBe(0.8);
    expect(c.speedStart).toBe(1.3);
    expect(c.rigDistance).toBe(2);
    expect(c.rigHeight).toBe(-0.2);
    expect(applied.sort()).toEqual(['dist', 'flap', 'g', 'gap', 'h', 'speed']);
  });

  it('ignores invalid, empty and out-of-range values', () => {
    const { cfg: c, applied } = parseOverrides('?g=abc&flap=&gap=5&speed=-1&dist=NaN&h=0.1');
    expect(c.gravity).toBe(CFG.gravity);
    expect(c.flapVelocity).toBe(CFG.flapVelocity);
    expect(c.gapStart).toBe(CFG.gapStart);
    expect(c.speedStart).toBe(CFG.speedStart);
    expect(c.rigDistance).toBe(CFG.rigDistance);
    expect(c.rigHeight).toBe(0.1);
    expect(applied).toEqual(['h']);
  });

  it('keeps the difficulty curve valid when the start is overridden', () => {
    const narrow = parseOverrides('?gap=0.4').cfg;
    expect(narrow.gapMin).toBe(0.4);
    const fast = parseOverrides('?speed=2').cfg;
    expect(fast.speedMax).toBe(2);
  });

  it('reads debug and model flags', () => {
    expect(parseOverrides('').flags).toEqual({ debug: false, model: 'placeholder' });
    expect(parseOverrides('?debug=1&model=joud').flags).toEqual({ debug: true, model: 'joud' });
    expect(parseOverrides('?model=other').flags.model).toBe('placeholder');
  });

  it('does not mutate the base config', () => {
    parseOverrides('?g=-9');
    expect(CFG.gravity).toBe(-5.5);
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

describe('best of the day', () => {
  it('builds a per-day storage key', () => {
    const d = new Date(2026, 10, 17, 16, 0);
    expect(dayKey(d)).toBe('2026-11-17');
    expect(bestStorageKey(d)).toBe('joudbird.best.2026-11-17');
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
