// Render tiers for phones. Tiers change rendering only (pixel ratio, antialias, effects,
// scenery, bird detail); the simulation is the same on every phone. Pure: no DOM here,
// so it is unit-tested in Node.

export type Tier = 'low' | 'medium' | 'high';
export const TIERS: readonly Tier[] = ['low', 'medium', 'high'];

export interface TierSettings {
  /** Cap on devicePixelRatio. */
  pixelRatio: number;
  /** Chosen once at start (a WebGL context cannot change it later). */
  antialias: boolean;
  /** Decorative motion: flower spin, updraft stripes, bird hit flash. */
  effects: boolean;
  /** Flower strip under the lane. */
  scenery: boolean;
  /** joud.glb (6k triangles) or the code-built placeholder (0.9k). */
  birdGlb: boolean;
}

export const TIER_SETTINGS: Readonly<Record<Tier, Readonly<TierSettings>>> = {
  low: { pixelRatio: 1, antialias: false, effects: false, scenery: false, birdGlb: false },
  medium: { pixelRatio: 1.5, antialias: true, effects: true, scenery: true, birdGlb: true },
  high: { pixelRatio: 2, antialias: true, effects: true, scenery: true, birdGlb: true },
};

export interface DeviceInfo {
  /** navigator.hardwareConcurrency (0 if unknown). */
  cores: number;
  /** navigator.deviceMemory in GB (Chrome only; 0 if unknown, e.g. Safari). */
  memoryGb: number;
  /** Screen size in CSS pixels. */
  screenW: number;
  screenH: number;
  dpr: number;
}

/**
 * Starting tier. Few cores or little memory → low. A large, dense screen on a mid
 * device → medium (filling it costs more than the game itself). Unknown values
 * (Safari reports no deviceMemory) do not count against a device.
 */
export function chooseTier(d: DeviceInfo): Tier {
  const cores = d.cores > 0 ? d.cores : 4;
  const mem = d.memoryGb > 0 ? d.memoryGb : 4;
  if (cores <= 2 || mem <= 2) return 'low';
  const devicePixels = d.screenW * d.screenH * d.dpr * d.dpr;
  if (cores <= 4 || mem <= 3) return devicePixels > 2_500_000 ? 'low' : 'medium';
  if (cores < 8 && devicePixels > 3_500_000) return 'medium';
  return 'high';
}

export function parseTier(value: string | null): Tier | null {
  return value === 'low' || value === 'medium' || value === 'high' ? value : null;
}

export function lowerTier(t: Tier): Tier {
  return t === 'high' ? 'medium' : 'low';
}

/**
 * Drops one tier when the average frame time stays above `limitMs` for `windowS`
 * seconds. Never steps up. Feed it real frame times (seconds); pauses and hidden tabs
 * should call reset() so a long frame after them doesn't count.
 */
export class FrameWatchdog {
  private sum = 0;
  private frames = 0;
  private slowFor = 0;

  constructor(
    private readonly limitMs = 20,
    private readonly windowS = 3,
    /** Frames are averaged over this many seconds before judging. */
    private readonly sampleS = 0.5,
  ) {}

  reset(): void {
    this.sum = 0;
    this.frames = 0;
    this.slowFor = 0;
  }

  /** Returns true when the tier should drop now (then it starts over). */
  frame(dt: number): boolean {
    if (!(dt > 0) || dt > 0.5) return false; // ignore hitches from tab switches
    this.sum += dt;
    this.frames++;
    if (this.sum < this.sampleS) return false;
    const avgMs = (this.sum / this.frames) * 1000;
    const span = this.sum;
    this.sum = 0;
    this.frames = 0;
    if (avgMs > this.limitMs) this.slowFor += span;
    else this.slowFor = 0;
    if (this.slowFor >= this.windowS) {
      this.slowFor = 0;
      return true;
    }
    return false;
  }
}
