import type { Config } from './config';
import { circleVsRect } from './physics';

/** One obstacle pair: a top and a bottom block with a gap between them. */
export interface Obstacle {
  active: boolean;
  /** Centre x in lane coords. Obstacles move towards +x. */
  x: number;
  /** Centre y of the gap. */
  gapY: number;
  /** Gap height. */
  gap: number;
  scored: boolean;
}

export const POOL_SIZE = 5;

/** Returns a number in [0, 1). Injected so tests are deterministic. */
export type Rng = () => number;

/**
 * Fixed pool of obstacle pairs. Nothing is allocated after construction:
 * pairs are recycled when they leave the lane.
 */
export class ObstacleField {
  readonly pool: Obstacle[];
  /** Distance travelled since the last spawn. */
  private sinceSpawn = 0;
  private lastGapY = 0;

  constructor(private readonly cfg: Readonly<Config>) {
    this.pool = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      this.pool.push({ active: false, x: 0, gapY: 0, gap: 0, scored: false });
    }
    this.reset();
  }

  /** Spawn x: fully outside the left edge of the lane. */
  get spawnX(): number {
    return -this.cfg.laneW / 2 - this.cfg.pipeWidth / 2;
  }

  /** Recycle x: fully outside the right edge of the lane. */
  get despawnX(): number {
    return this.cfg.laneW / 2 + this.cfg.pipeWidth / 2;
  }

  reset(): void {
    for (const o of this.pool) o.active = false;
    // First obstacle spawns on the first update.
    this.sinceSpawn = this.cfg.spacing;
    this.lastGapY = 0;
  }

  activeCount(): number {
    let n = 0;
    for (const o of this.pool) if (o.active) n++;
    return n;
  }

  /**
   * Move every obstacle by speed·dt, recycle the ones that left the lane,
   * spawn new ones every `spacing` metres, and return the points scored
   * (bird centre passed an obstacle's trailing edge).
   */
  update(dt: number, speed: number, nextGap: number, rng: Rng): number {
    const dx = speed * dt;
    const half = this.cfg.pipeWidth / 2;
    let points = 0;

    for (const o of this.pool) {
      if (!o.active) continue;
      o.x += dx;
      if (!o.scored && o.x - half > this.cfg.birdX) {
        o.scored = true;
        points++;
      }
      if (o.x >= this.despawnX) o.active = false;
    }

    this.sinceSpawn += dx;
    if (this.sinceSpawn >= this.cfg.spacing) {
      const o = this.pool.find((p) => !p.active);
      if (o) {
        // Keep the spacing exact even when a frame overshoots it.
        const overshoot = this.sinceSpawn - this.cfg.spacing;
        this.sinceSpawn = overshoot;
        o.active = true;
        o.x = this.spawnX + overshoot;
        o.gap = nextGap;
        o.gapY = this.pickGapY(nextGap, rng);
        o.scored = false;
      }
    }
    return points;
  }

  /** True if a circle at (x, y) with radius r touches any active obstacle. */
  hits(x: number, y: number, r: number): boolean {
    const half = this.cfg.pipeWidth / 2;
    const top = this.cfg.laneH / 2;
    for (const o of this.pool) {
      if (!o.active) continue;
      const x0 = o.x - half;
      const x1 = o.x + half;
      // Top block: from the gap's upper edge to the ceiling (and beyond).
      if (circleVsRect(x, y, r, x0, o.gapY + o.gap / 2, x1, top + 1)) return true;
      // Bottom block: from below the floor to the gap's lower edge.
      if (circleVsRect(x, y, r, x0, -top - 1, x1, o.gapY - o.gap / 2)) return true;
    }
    return false;
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
