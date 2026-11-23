import type { Config, Mode } from './config';
import type { Fnv } from './hash';
import { circleVsRect } from './physics';
import {
  type CourseTuning,
  KINDS,
  type KindTuning,
  maxPoints,
  type ObstacleKind,
  type PointsTable,
  type Ruleset,
  VR1,
} from './ruleset';

/**
 * One obstacle: blocks above and below a gap (a fork has two gaps and a block between).
 * Every field is set on spawn; nothing is allocated after construction.
 */
export interface Obstacle {
  active: boolean;
  /** Centre x in lane coords. Obstacles move towards +x. */
  x: number;
  /** Centre y of the gap (a fork's safe, wider gap). */
  gapY: number;
  /** Gap height. */
  gap: number;
  scored: boolean;
  kind: ObstacleKind;
  /** Points paid when passed (forks pay by the side the bird used). */
  points: number;
  /** Moving gap: centre, offset from it, direction (+1/-1) and amplitude (0 = not moving). */
  baseY: number;
  moveY: number;
  moveDir: number;
  moveAmp: number;
  /** Fork: the risky, narrower gap (gap2 = 0 when not a fork). */
  gap2Y: number;
  gap2: number;
  /** Updraft column length in front of the gate (0 = none). */
  updraft: number;
  /** Flower: 0 none, 1 waiting, 2 collected. It sits at the obstacle's x. */
  flower: number;
  flowerY: number;
  /** Fork: which gap the bird used. 0 not yet, 1 safe, 2 risky. */
  forkSide: number;
}

/** Minimum pool size (the VR lane needs 4). */
export const POOL_SIZE = 5;

/** Returns a number in [0, 1). Injected so tests are deterministic. */
export type Rng = () => number;

const KIND_INDEX: Record<ObstacleKind, number> = {
  gate: 0,
  stairs: 1,
  updraft: 2,
  narrow: 3,
  moving: 4,
  fork: 5,
};

function blank(): Obstacle {
  return {
    active: false,
    x: 0,
    gapY: 0,
    gap: 0,
    scored: false,
    kind: 'gate',
    points: 0,
    baseY: 0,
    moveY: 0,
    moveDir: 1,
    moveAmp: 0,
    gap2Y: 0,
    gap2: 0,
    updraft: 0,
    flower: 0,
    flowerY: 0,
    forkSide: 0,
  };
}

function poolSizeFor(cfg: Readonly<Config>): number {
  return Math.max(POOL_SIZE, Math.ceil((cfg.laneW + cfg.pipeWidth) / cfg.spacing) + 1);
}

/**
 * Fixed pool of obstacles plus the seeded course that fills it. Nothing is allocated
 * after construction: obstacles are recycled when they leave the lane.
 */
export class ObstacleField {
  readonly pool: Obstacle[];
  /** Distance travelled since the last spawn. */
  private sinceSpawn = 0;
  private lastGapY = 0;
  /** Obstacles spawned this round (drives the course ramp). */
  spawned = 0;
  /** Obstacles passed this round (drives speed and gap). */
  passed = 0;
  /** Flowers collected in the last update. */
  flowersGot = 0;
  private stairsLeft = 0;
  private stairsDir = 1;
  /** The last obstacle could pay 3 or more: the next one is a plain gate. */
  private lastHigh = false;

  private ruleset: Readonly<Ruleset>;
  private course: Readonly<CourseTuning>;
  /** vr-1 style course: one rng() per spawn, exactly as the VR game always did. */
  private gatesOnly = true;

  /** Coverage counters for tests (not part of the hashed state). */
  readonly passedKinds: number[] = [0, 0, 0, 0, 0, 0];
  forkSafe = 0;
  forkRisky = 0;
  flowersTaken = 0;

  constructor(
    private cfg: Readonly<Config>,
    ruleset: Readonly<Ruleset> = VR1,
    mode: Mode = 'normal',
  ) {
    this.ruleset = ruleset;
    this.course = ruleset.course[mode];
    this.pool = [];
    this.setConfig(cfg, mode);
  }

  private get kinds(): Readonly<KindTuning> {
    return this.ruleset.kinds;
  }

  private get pts(): Readonly<PointsTable> {
    return this.ruleset.points;
  }

  /** Spawn x: fully outside the left edge of the lane. */
  get spawnX(): number {
    return -this.cfg.laneW / 2 - this.cfg.pipeWidth / 2;
  }

  /** Recycle x: fully outside the right edge of the lane. */
  get despawnX(): number {
    return this.cfg.laneW / 2 + this.cfg.pipeWidth / 2;
  }

  /** Switch to another difficulty; clears the field. */
  setConfig(cfg: Readonly<Config>, mode?: Mode): void {
    this.cfg = cfg;
    if (mode) this.course = this.ruleset.course[mode];
    const c = this.course;
    this.gatesOnly = c.flowerChance === 0;
    for (const k of KINDS) {
      if (k !== 'gate' && (c.start[k] > 0 || c.end[k] > 0)) this.gatesOnly = false;
    }
    const size = poolSizeFor(cfg);
    while (this.pool.length < size) this.pool.push(blank());
    this.reset();
  }

  reset(): void {
    for (const o of this.pool) o.active = false;
    // First obstacle spawns on the first update.
    this.sinceSpawn = this.cfg.spacing;
    this.lastGapY = 0;
    this.spawned = 0;
    this.passed = 0;
    this.flowersGot = 0;
    this.stairsLeft = 0;
    this.stairsDir = 1;
    this.lastHigh = false;
    for (let i = 0; i < this.passedKinds.length; i++) this.passedKinds[i] = 0;
    this.forkSafe = 0;
    this.forkRisky = 0;
    this.flowersTaken = 0;
  }

  activeCount(): number {
    let n = 0;
    for (const o of this.pool) if (o.active) n++;
    return n;
  }

  /**
   * Move every obstacle by speed·dt, collect flowers, recycle obstacles that left the
   * lane, spawn new ones every `spacing` metres, and return the points scored (bird
   * centre passed an obstacle's trailing edge). `flowersGot` holds the flowers taken.
   */
  update(dt: number, speed: number, nextGap: number, rng: Rng, birdY = 0): number {
    const dx = speed * dt;
    const half = this.cfg.pipeWidth / 2;
    const bx = this.cfg.birdX;
    let points = 0;
    this.flowersGot = 0;

    for (let i = 0; i < this.pool.length; i++) {
      const o = this.pool[i];
      if (!o.active) continue;
      o.x += dx;
      if (o.moveAmp > 0) this.moveGap(o, dt);
      if (o.flower === 1) {
        const ddx = bx - o.x;
        const ddy = birdY - o.flowerY;
        const reach = this.cfg.birdRadius + this.kinds.flowerRadius;
        if (ddx * ddx + ddy * ddy <= reach * reach) {
          o.flower = 2;
          this.flowersGot++;
          this.flowersTaken++;
        }
      }
      if (!o.scored && o.x - half > bx) {
        o.scored = true;
        this.passed++;
        this.passedKinds[KIND_INDEX[o.kind]]++;
        if (o.kind === 'fork') {
          // The bird is beyond the fork: the side of the middle block it is on is the gap it used.
          const mid = (o.gapY + o.gap2Y) / 2;
          const safe = birdY > mid === o.gapY > o.gap2Y;
          o.forkSide = safe ? 1 : 2;
          if (safe) this.forkSafe++;
          else this.forkRisky++;
          points += safe ? this.pts.forkSafe : this.pts.forkRisky;
        } else {
          points += o.points;
        }
      }
      if (o.x >= this.despawnX) o.active = false;
    }

    this.sinceSpawn += dx;
    if (this.sinceSpawn >= this.cfg.spacing) {
      const o = this.freeSlot();
      if (o) {
        // Keep the spacing exact even when a frame overshoots it.
        const overshoot = this.sinceSpawn - this.cfg.spacing;
        this.sinceSpawn = overshoot;
        o.x = this.spawnX + overshoot;
        this.spawn(o, nextGap, rng);
      }
    }
    return points;
  }

  /** Upward acceleration at lane x (inside an updraft column), else 0. */
  liftAt(x: number): number {
    const half = this.cfg.pipeWidth / 2;
    for (let i = 0; i < this.pool.length; i++) {
      const o = this.pool[i];
      if (!o.active || o.updraft === 0) continue;
      const lead = o.x + half;
      if (x >= lead && x <= lead + o.updraft) return this.kinds.updraftLift;
    }
    return 0;
  }

  /** True if a circle at (x, y) with radius r touches any active obstacle. */
  hits(x: number, y: number, r: number): boolean {
    const half = this.cfg.pipeWidth / 2;
    const top = this.cfg.laneH / 2;
    for (let i = 0; i < this.pool.length; i++) {
      const o = this.pool[i];
      if (!o.active) continue;
      const x0 = o.x - half;
      const x1 = o.x + half;
      let upperY = o.gapY;
      let upper = o.gap;
      let lowerY = o.gapY;
      let lower = o.gap;
      if (o.gap2 > 0) {
        if (o.gap2Y > o.gapY) {
          upperY = o.gap2Y;
          upper = o.gap2;
        } else {
          lowerY = o.gap2Y;
          lower = o.gap2;
        }
        // Middle block of a fork, between the two gaps.
        if (circleVsRect(x, y, r, x0, lowerY + lower / 2, x1, upperY - upper / 2)) return true;
      }
      // Top block: from the (upper) gap's top edge to the ceiling (and beyond).
      if (circleVsRect(x, y, r, x0, upperY + upper / 2, x1, top + 1)) return true;
      // Bottom block: from below the floor to the (lower) gap's bottom edge.
      if (circleVsRect(x, y, r, x0, -top - 1, x1, lowerY - lower / 2)) return true;
    }
    return false;
  }

  /** Feed the course state and every obstacle field into a hash, in a fixed order. */
  hashInto(h: Fnv): void {
    h.f64(this.sinceSpawn).f64(this.lastGapY).f64(this.spawned).f64(this.passed);
    h.f64(this.stairsLeft).f64(this.stairsDir).f64(this.lastHigh ? 1 : 0);
    for (let i = 0; i < this.pool.length; i++) {
      const o = this.pool[i];
      h.f64(o.active ? 1 : 0).f64(o.x).f64(o.gapY).f64(o.gap).f64(o.scored ? 1 : 0);
      h.f64(KIND_INDEX[o.kind]).f64(o.points);
      h.f64(o.baseY).f64(o.moveY).f64(o.moveDir).f64(o.moveAmp);
      h.f64(o.gap2Y).f64(o.gap2).f64(o.updraft);
      h.f64(o.flower).f64(o.flowerY).f64(o.forkSide);
    }
  }

  private freeSlot(): Obstacle | null {
    for (let i = 0; i < this.pool.length; i++) if (!this.pool[i].active) return this.pool[i];
    return null;
  }

  /** Linear ping-pong (triangle wave) of a moving gap's centre. */
  private moveGap(o: Obstacle, dt: number): void {
    const amp = o.moveAmp;
    o.moveY += o.moveDir * this.kinds.movingSpeed * dt;
    if (o.moveY > amp) {
      o.moveY = 2 * amp - o.moveY;
      o.moveDir = -1;
    } else if (o.moveY < -amp) {
      o.moveY = -2 * amp - o.moveY;
      o.moveDir = 1;
    }
    o.gapY = o.baseY + o.moveY;
  }

  private nextKind(rng: Rng): ObstacleKind {
    if (this.gatesOnly) return 'gate';
    if (this.stairsLeft > 0) return 'stairs';
    if (this.lastHigh) return 'gate';
    const c = this.course;
    const t = Math.min(1, this.spawned / c.rampObstacles);
    let total = 0;
    for (const k of KINDS) total += c.start[k] + (c.end[k] - c.start[k]) * t;
    let r = rng() * total;
    for (const k of KINDS) {
      const w = c.start[k] + (c.end[k] - c.start[k]) * t;
      if (w <= 0) continue;
      if (r < w) return k;
      r -= w;
    }
    return 'gate';
  }

  private spawn(o: Obstacle, gap: number, rng: Rng): void {
    const k = this.kinds;
    const kind = this.nextKind(rng);
    o.active = true;
    o.scored = false;
    o.kind = kind;
    o.points = kind === 'fork' ? this.pts.forkSafe : this.pts[kind];
    o.gap = gap;
    o.baseY = 0;
    o.moveY = 0;
    o.moveDir = 1;
    o.moveAmp = 0;
    o.gap2Y = 0;
    o.gap2 = 0;
    o.updraft = 0;
    o.flower = 0;
    o.flowerY = 0;
    o.forkSide = 0;

    switch (kind) {
      case 'gate':
        o.gapY = this.pickGapY(gap, rng);
        break;
      case 'stairs':
        o.gapY = this.stairsGapY(gap, rng);
        break;
      case 'updraft':
        o.gapY = this.pickGapY(gap, rng);
        o.updraft = k.updraftLength;
        break;
      case 'narrow':
        o.gap = Math.max(k.narrowMin, gap * k.narrowFactor);
        o.gapY = this.pickGapY(o.gap, rng);
        break;
      case 'moving':
        o.moveAmp = k.movingAmplitude;
        // Pick the centre as if the gap were 2·amplitude taller, so the whole swing fits.
        o.baseY = this.pickGapY(gap + 2 * o.moveAmp, rng);
        o.gapY = o.baseY;
        o.moveDir = rng() < 0.5 ? 1 : -1;
        break;
      case 'fork': {
        const risky = Math.max(k.narrowMin, gap * k.forkRiskyFactor);
        const total = gap + k.forkBlock + risky;
        const centre = this.pickGapY(total, rng);
        const riskyOnTop = rng() < 0.5;
        const topEdge = centre + total / 2;
        const bottomEdge = centre - total / 2;
        o.gap2 = risky;
        o.gap2Y = riskyOnTop ? topEdge - risky / 2 : bottomEdge + risky / 2;
        o.gapY = riskyOnTop ? bottomEdge + gap / 2 : topEdge - gap / 2;
        break;
      }
    }

    if (this.course.flowerChance > 0 && kind !== 'moving' && rng() < this.course.flowerChance) {
      o.flower = 1;
      o.flowerY = kind === 'fork' ? o.gap2Y : o.gapY;
    }
    this.lastHigh = maxPoints(kind, this.pts) >= 3;
    this.spawned++;
  }

  /** Three gates whose centres step the same direction by stairsStep, all inside the lane. */
  private stairsGapY(gap: number, rng: Rng): number {
    const k = this.kinds;
    const limit = this.cfg.laneH / 2 - this.cfg.gapMargin - gap / 2;
    if (this.stairsLeft === 0) {
      this.stairsLeft = k.stairsCount;
      this.stairsDir = rng() < 0.5 ? 1 : -1;
      let y = this.pickGapY(gap, rng);
      const span = k.stairsStep * (k.stairsCount - 1);
      // Flip the direction rather than move the start (which could break maxGapShift).
      if (this.stairsDir > 0 && y > limit - span) this.stairsDir = -1;
      else if (this.stairsDir < 0 && y < -limit + span) this.stairsDir = 1;
      // Lane too short for the whole flight: clamp as a last resort.
      if (this.stairsDir > 0 && y > limit - span) y = limit - span;
      if (this.stairsDir < 0 && y < -limit + span) y = -limit + span;
      this.lastGapY = y;
    } else {
      let y = this.lastGapY + this.stairsDir * k.stairsStep;
      if (y > limit) y = limit;
      if (y < -limit) y = -limit;
      this.lastGapY = y;
    }
    this.stairsLeft--;
    return this.lastGapY;
  }

  private pickGapY(gap: number, rng: Rng): number {
    const limit = this.cfg.laneH / 2 - this.cfg.gapMargin - gap / 2;
    if (limit <= 0) return 0;
    let y = (rng() * 2 - 1) * limit;
    // Keep neighbouring gaps reachable.
    const shift = this.cfg.maxGapShift;
    if (y > this.lastGapY + shift) y = this.lastGapY + shift;
    if (y < this.lastGapY - shift) y = this.lastGapY - shift;
    if (y > limit) y = limit;
    if (y < -limit) y = -limit;
    this.lastGapY = y;
    return y;
  }
}
