// Game constants (metres, seconds), difficulty presets and URL overrides.
// Plain TypeScript: no DOM, no Three.js, no IWSDK. See docs/spec.md.

export interface Config {
  gravity: number; // m/s²
  flapVelocity: number; // SET, not added: vy = flapVelocity
  maxFall: number; // most negative vy
  birdRadius: number;
  birdX: number; // fixed x in lane coords (the bird flies left, obstacles move right)
  pipeWidth: number;
  gapStart: number;
  gapMin: number;
  gapShrinkPerPoint: number;
  gapMargin: number; // min distance from a gap edge to the floor/ceiling
  maxGapShift: number; // max change of gap centre between neighbours
  spacing: number; // distance between obstacles
  speedStart: number;
  speedMax: number;
  speedPerPoint: number;
  /** Floor and ceiling bounce the bird instead of ending the round. */
  softBounds: boolean;
  laneW: number;
  laneH: number;
  rigDistance: number; // PlayRig distance ahead of the head
  rigHeight: number; // offset from eye height
  restartLockout: number; // trigger can't restart until this long after game over
  step: number; // fixed simulation step
  maxFrame: number; // longest frame we simulate after a hitch
}

/** Base constants. The difficulty values here are the original spec ("hard"). */
export const CFG: Readonly<Config> = Object.freeze({
  gravity: -5.5,
  flapVelocity: 2.1,
  maxFall: -3.5,
  birdRadius: 0.12,
  birdX: 0.6,
  pipeWidth: 0.35,
  gapStart: 0.7,
  gapMin: 0.52,
  gapShrinkPerPoint: 0.01,
  gapMargin: 0.12,
  maxGapShift: 0.45,
  spacing: 1.3,
  speedStart: 1.1,
  speedMax: 1.5,
  speedPerPoint: 0.02,
  softBounds: false,
  laneW: 2.8,
  laneH: 1.6,
  rigDistance: 2.5,
  rigHeight: 0,
  restartLockout: 0.8,
  step: 1 / 120,
  maxFrame: 0.1,
});

export type Mode = 'easy' | 'normal' | 'hard';
export const MODES: readonly Mode[] = ['easy', 'normal', 'hard'];
export const DEFAULT_MODE: Mode = 'normal';

/** Difficulty presets, applied over CFG. */
export const PRESETS: Readonly<Record<Mode, Readonly<Partial<Config>>>> = Object.freeze({
  // Kids and families: wide fixed gap, slow fixed speed, no ramp, soft floor and ceiling.
  easy: Object.freeze({
    flapVelocity: 1.7,
    gapStart: 1.0,
    gapMin: 1.0,
    gapShrinkPerPoint: 0,
    speedStart: 0.9,
    speedMax: 0.9,
    speedPerPoint: 0,
    spacing: 1.6,
    softBounds: true,
  }),
  normal: Object.freeze({
    flapVelocity: 1.9,
    gapStart: 0.85,
    gapMin: 0.65,
    speedStart: 1.0,
    speedMax: 1.3,
  }),
  // The original spec values (= CFG).
  hard: Object.freeze({}),
});

export function isMode(value: unknown): value is Mode {
  return value === 'easy' || value === 'normal' || value === 'hard';
}

/**
 * CFG → preset for `mode` → URL overrides (which always win).
 * Keeps the difficulty curve valid when an override moves its start.
 */
export function configFor(mode: Mode, overrides: Readonly<Partial<Config>> = {}): Config {
  const cfg: Config = { ...CFG, ...PRESETS[mode], ...overrides };
  cfg.gapMin = Math.min(cfg.gapMin, cfg.gapStart);
  cfg.speedMax = Math.max(cfg.speedMax, cfg.speedStart);
  return cfg;
}

export interface UrlFlags {
  debug: boolean;
  /** Bird: the Joud GLB by default; ?model=placeholder forces the primitive bird. */
  model: 'placeholder' | 'joud';
  /** Visual effects (sparkles, score burst, score pop, hit flash). ?fx=0 turns them off. */
  fx: boolean;
  /** Sound starts muted with ?mute=1. */
  mute: boolean;
}

export interface UrlSettings {
  /** Operator's default mode (?mode=), or DEFAULT_MODE. */
  mode: Mode;
  /** Numeric overrides (?g=&flap=&gap=&speed=&dist=&h=), applied over any preset. */
  overrides: Partial<Config>;
  flags: UrlFlags;
  /** Parameter names that were applied, for the debug HUD. */
  applied: string[];
}

// URL parameter → config key, with sane bounds so a typo can't break the game.
const NUMERIC: Record<string, { key: keyof Config; min: number; max: number }> = {
  g: { key: 'gravity', min: -30, max: -0.5 },
  flap: { key: 'flapVelocity', min: 0.3, max: 8 },
  gap: { key: 'gapStart', min: 0.3, max: 1.2 },
  speed: { key: 'speedStart', min: 0.2, max: 4 },
  dist: { key: 'rigDistance', min: 1, max: 6 },
  h: { key: 'rigHeight', min: -1, max: 1 },
};

/**
 * Read `?mode=&g=&flap=&gap=&speed=&dist=&h=&debug=1&model=placeholder&fx=0&mute=1`.
 * Invalid or out-of-range values are ignored.
 */
export function parseUrl(search: string): UrlSettings {
  const params = new URLSearchParams(search);
  const overrides: Partial<Config> = {};
  const applied: string[] = [];

  for (const [param, { key, min, max }] of Object.entries(NUMERIC)) {
    const raw = params.get(param);
    if (raw === null || raw.trim() === '') continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min || value > max) continue;
    (overrides as Record<string, number>)[key] = value;
    applied.push(param);
  }

  const rawMode = params.get('mode');
  const mode = isMode(rawMode) ? rawMode : DEFAULT_MODE;
  if (isMode(rawMode)) applied.push('mode');

  const debug = params.get('debug');
  const flags: UrlFlags = {
    debug: debug === '1' || debug === 'true',
    model: params.get('model') === 'placeholder' ? 'placeholder' : 'joud',
    fx: params.get('fx') !== '0',
    mute: params.get('mute') === '1',
  };
  return { mode, overrides, flags, applied };
}

/** Gap height for the next obstacle at this score. */
export function gapForScore(score: number, cfg: Readonly<Config>): number {
  return Math.max(cfg.gapMin, cfg.gapStart - cfg.gapShrinkPerPoint * score);
}

/** Obstacle speed at this score. */
export function speedForScore(score: number, cfg: Readonly<Config>): number {
  return Math.min(cfg.speedMax, cfg.speedStart + cfg.speedPerPoint * score);
}
