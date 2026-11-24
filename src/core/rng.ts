// Seeded random numbers. Only Math.imul and integer bit operations: every JS engine
// (V8 in Chrome, Node and Deno; JavaScriptCore in Safari) gives the same sequence.

/** mulberry32. `next()` returns u32 / 2^32, a double in [0, 1). */
export class Prng {
  /** Internal state, kept as an int32. */
  private s = 0;

  constructor(seed = 0) {
    this.seed(seed);
  }

  seed(seed: number): void {
    this.s = seed | 0;
  }

  /** State as a uint32, for hashing. */
  get state(): number {
    return this.s >>> 0;
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

/** A seed is an integer in [0, 2^32). */
export function isSeed(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

/** Deterministic next seed (murmur3 finaliser), used when the shell gives no seed source. */
export function mixSeed(seed: number): number {
  let h = (seed + 0x9e3779b9) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
