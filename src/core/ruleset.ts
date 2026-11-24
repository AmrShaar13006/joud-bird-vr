// Rulesets: everything that affects a run's result. A run is fully described by
// (ruleset id, mode, seed, flap ticks). Changing any value here needs a NEW id and
// regenerated fixtures (`npm run fixtures`); a test compares the stored constants hash.
// See docs/mobile.md.

import { CFG, type Config, configFor, type Mode, MODES } from './config';
import { Fnv } from './hash';

export const KINDS = ['gate', 'stairs', 'updraft', 'narrow', 'moving', 'fork'] as const;
export type ObstacleKind = (typeof KINDS)[number];
export type KindWeights = Readonly<Record<ObstacleKind, number>>;

export interface PointsTable {
  gate: number;
  stairs: number;
  updraft: number;
  narrow: number;
  moving: number;
  forkSafe: number;
  forkRisky: number;
  flower: number;
}

/** How a course is drawn in one mode. Weights ramp linearly from `start` to `end`. */
export interface CourseTuning {
  start: KindWeights;
  end: KindWeights;
  /** Obstacles spawned until the `end` weights are reached. */
  rampObstacles: number;
  /** Chance that an obstacle (not a moving gap) carries a flower. */
  flowerChance: number;
}

/** Shape parameters for the obstacle kinds (sim metres, seconds). */
export interface KindTuning {
  stairsCount: number;
  /** Gap centre step between stairs (≤ maxGapShift). */
  stairsStep: number;
  /** Length of the updraft column in front of its gate (0 = no updraft). */
  updraftLength: number;
  /** Upward acceleration inside the column, m/s². */
  updraftLift: number;
  narrowFactor: number;
  /** Smallest gap a narrow or risky fork gap may have. */
  narrowMin: number;
  movingAmplitude: number;
  movingSpeed: number;
  /** Height of the block between a fork's two gaps. */
  forkBlock: number;
  forkRiskyFactor: number;
  flowerRadius: number;
}

export interface Ruleset {
  id: string;
  /** Fixed simulation step, seconds (also in every mode's Config). */
  step: number;
  /** Longest run, in ticks (15 minutes). */
  maxTicks: number;
  modes: Readonly<Record<Mode, Readonly<Config>>>;
  points: Readonly<PointsTable>;
  multipliers: Readonly<Record<Mode, number>>;
  course: Readonly<Record<Mode, Readonly<CourseTuning>>>;
  kinds: Readonly<KindTuning>;
}

/** Ticks between checkpoint hashes. */
export const CHECKPOINT_TICKS = 600;
/** Longest mobile run: 15 minutes at 60 Hz. Logs above this are invalid. */
export const MAX_TICKS = 60 * 60 * 15;

const ZERO: KindWeights = { gate: 0, stairs: 0, updraft: 0, narrow: 0, moving: 0, fork: 0 };
const GATES_ONLY: KindWeights = { ...ZERO, gate: 1 };

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}

// ---------- vr-1: the VR booth game of 17 Nov, unchanged ----------

const VR_COURSE: CourseTuning = { start: GATES_ONLY, end: GATES_ONLY, rampObstacles: 1, flowerChance: 0 };

export const VR1: Readonly<Ruleset> = deepFreeze({
  id: 'vr-1',
  step: CFG.step,
  maxTicks: 120 * 60 * 15,
  modes: { easy: configFor('easy'), normal: configFor('normal'), hard: configFor('hard') },
  points: { gate: 1, stairs: 1, updraft: 1, narrow: 1, moving: 1, forkSafe: 1, forkRisky: 1, flower: 0 },
  multipliers: { easy: 1, normal: 2, hard: 3 },
  course: { easy: VR_COURSE, normal: VR_COURSE, hard: VR_COURSE },
  kinds: {
    stairsCount: 3,
    stairsStep: 0,
    updraftLength: 0,
    updraftLift: 0,
    narrowFactor: 1,
    narrowMin: 0,
    movingAmplitude: 0,
    movingSpeed: 0,
    forkBlock: 0,
    forkRiskyFactor: 1,
    flowerRadius: 0,
  },
});

// ---------- mobile-1: portrait phone game ----------
// Lane 1.0 × 1.8. The bird sits 0.35 right of centre, so 0.85 of lane lies ahead:
// 0.85 / 0.34 spacing ≈ 2.5 obstacles visible ahead (2.2 in easy).

const MOBILE_STEP = 1 / 60;

const MOBILE_BASE: Config = {
  ...CFG,
  gravity: -2.6,
  flapVelocity: 0.78,
  maxFall: -1.5,
  birdRadius: 0.04,
  birdX: 0.35,
  pipeWidth: 0.09,
  gapStart: 0.29,
  gapMin: 0.22,
  gapShrinkPerPoint: 0.002,
  gapMargin: 0.08,
  maxGapShift: 0.16,
  spacing: 0.34,
  speedStart: 0.33,
  speedMax: 0.42,
  speedPerPoint: 0.0025,
  softBounds: false,
  laneW: 1.0,
  laneH: 1.8,
  step: MOBILE_STEP,
  maxFrame: 0.1,
};

const MOBILE_MODES: Record<Mode, Config> = {
  easy: {
    ...MOBILE_BASE,
    gravity: -2.2,
    flapVelocity: 0.7,
    gapStart: 0.36,
    gapMin: 0.36,
    gapShrinkPerPoint: 0,
    speedStart: 0.3,
    speedMax: 0.3,
    speedPerPoint: 0,
    spacing: 0.38,
    softBounds: true,
  },
  normal: { ...MOBILE_BASE },
  hard: {
    ...MOBILE_BASE,
    flapVelocity: 0.82,
    gapStart: 0.25,
    gapMin: 0.19,
    speedStart: 0.37,
    speedMax: 0.48,
    speedPerPoint: 0.003,
  },
};

export const MOBILE1: Readonly<Ruleset> = deepFreeze({
  id: 'mobile-1',
  step: MOBILE_STEP,
  maxTicks: MAX_TICKS,
  modes: MOBILE_MODES,
  points: { gate: 1, stairs: 2, updraft: 2, narrow: 3, moving: 3, forkSafe: 1, forkRisky: 5, flower: 1 },
  multipliers: { easy: 1, normal: 2, hard: 3 },
  course: {
    // Easy: gate, stairs, updraft and fork only; never a moving gap.
    easy: {
      start: { ...ZERO, gate: 6, stairs: 1, updraft: 1, fork: 1 },
      end: { ...ZERO, gate: 3, stairs: 2, updraft: 2, fork: 2 },
      rampObstacles: 40,
      flowerChance: 0.4,
    },
    normal: {
      start: { gate: 6, stairs: 1, updraft: 1, narrow: 1, moving: 0.5, fork: 1 },
      end: { gate: 2, stairs: 2, updraft: 1.5, narrow: 2, moving: 2, fork: 2 },
      rampObstacles: 50,
      flowerChance: 0.3,
    },
    hard: {
      start: { gate: 4, stairs: 1.5, updraft: 1, narrow: 1.5, moving: 1, fork: 1.5 },
      end: { gate: 1.5, stairs: 2, updraft: 1.5, narrow: 2.5, moving: 2.5, fork: 2 },
      rampObstacles: 40,
      flowerChance: 0.25,
    },
  },
  kinds: {
    stairsCount: 3,
    stairsStep: 0.1,
    updraftLength: 0.2,
    updraftLift: 1.2,
    narrowFactor: 0.75,
    narrowMin: 0.14,
    movingAmplitude: 0.08,
    movingSpeed: 0.1,
    forkBlock: 0.08,
    forkRiskyFactor: 0.62,
    flowerRadius: 0.035,
  },
});

export const RULESETS: Readonly<Record<string, Readonly<Ruleset>>> = Object.freeze({
  [VR1.id]: VR1,
  [MOBILE1.id]: MOBILE1,
});
export const RULESET_IDS: readonly string[] = Object.freeze(Object.keys(RULESETS));

export function getRuleset(id: unknown): Readonly<Ruleset> | undefined {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(RULESETS, id)
    ? RULESETS[id]
    : undefined;
}

/** Highest points one obstacle of this kind can pay. */
export function maxPoints(kind: ObstacleKind, points: Readonly<PointsTable>): number {
  return kind === 'fork' ? Math.max(points.forkSafe, points.forkRisky) : points[kind];
}

/** Impact points: score × the mode's multiplier (easy 1, normal 2, hard 3). */
export function impactPoints(score: number, mode: Mode, ruleset: Readonly<Ruleset>): number {
  return score * ruleset.multipliers[mode];
}

// Config keys that do not affect a result (VR placement, restart lockout, frame clamp).
const NON_SIM_KEYS = new Set(['rigDistance', 'rigHeight', 'restartLockout', 'maxFrame']);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => canonical(v)).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value)
      .filter((k) => !NON_SIM_KEYS.has(k))
      .sort();
    const obj = value as Record<string, unknown>;
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** FNV-1a over the canonical JSON of every result-affecting constant. */
export function rulesetHash(ruleset: Readonly<Ruleset>): string {
  return new Fnv().str(canonical(ruleset)).hex();
}

/** For tests: every mode's step must match the ruleset's. */
export function rulesetIsConsistent(ruleset: Readonly<Ruleset>): boolean {
  for (const m of MODES) if (ruleset.modes[m].step !== ruleset.step) return false;
  return true;
}
