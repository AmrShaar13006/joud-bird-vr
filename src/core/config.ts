// Game constants (metres, seconds) and URL overrides.
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
  laneW: number;
  laneH: number;
  rigDistance: number; // PlayRig distance ahead of the head
  rigHeight: number; // offset from eye height
  restartLockout: number; // trigger can't restart until this long after game over
  step: number; // fixed simulation step
  maxFrame: number; // longest frame we simulate after a hitch
}

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
  laneW: 2.8,
  laneH: 1.6,
  rigDistance: 2.5,
  rigHeight: 0,
  restartLockout: 0.8,
  step: 1 / 120,
  maxFrame: 0.1,
});

export interface UrlFlags {
  debug: boolean;
  model: 'placeholder' | 'joud';
}

export interface ParsedOverrides {
  cfg: Config;
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
 * Apply `?g=&flap=&gap=&speed=&dist=&h=&debug=1&model=joud` on top of `base`.
 * Invalid or out-of-range values are ignored.
 */
export function parseOverrides(search: string, base: Readonly<Config> = CFG): ParsedOverrides {
  const params = new URLSearchParams(search);
  const cfg: Config = { ...base };
  const applied: string[] = [];

  for (const [param, { key, min, max }] of Object.entries(NUMERIC)) {
    const raw = params.get(param);
    if (raw === null || raw.trim() === '') continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min || value > max) continue;
    cfg[key] = value;
    applied.push(param);
  }
  // Keep the difficulty curve consistent with an overridden starting point.
  cfg.gapMin = Math.min(cfg.gapMin, cfg.gapStart);
  cfg.speedMax = Math.max(cfg.speedMax, cfg.speedStart);

  const debug = params.get('debug');
  const flags: UrlFlags = {
    debug: debug === '1' || debug === 'true',
    model: params.get('model') === 'joud' ? 'joud' : 'placeholder',
  };
  return { cfg, flags, applied };
}

/** Gap height for the next obstacle at this score. */
export function gapForScore(score: number, cfg: Readonly<Config>): number {
  return Math.max(cfg.gapMin, cfg.gapStart - cfg.gapShrinkPerPoint * score);
}

/** Obstacle speed at this score. */
export function speedForScore(score: number, cfg: Readonly<Config>): number {
  return Math.min(cfg.speedMax, cfg.speedStart + cfg.speedPerPoint * score);
}
