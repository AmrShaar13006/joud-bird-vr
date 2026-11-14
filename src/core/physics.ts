import type { Config } from './config';

export interface Body {
  y: number;
  vy: number;
}

/** Semi-implicit Euler: velocity first (clamped to maxFall), then position. */
export function integrate(body: Body, dt: number, cfg: Readonly<Config>): void {
  body.vy += cfg.gravity * dt;
  if (body.vy < cfg.maxFall) body.vy = cfg.maxFall;
  body.y += body.vy * dt;
}

/** A flap sets the vertical speed; it does not add to it. */
export function flap(body: Body, cfg: Readonly<Config>): void {
  body.vy = cfg.flapVelocity;
}

/**
 * Circle (cx, cy, r) against the axis-aligned rectangle [x0, x1] × [y0, y1].
 * Uses the closest point on the rectangle to the circle centre.
 * Touching counts as a hit.
 */
export function circleVsRect(
  cx: number,
  cy: number,
  r: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  const px = cx < x0 ? x0 : cx > x1 ? x1 : cx;
  const py = cy < y0 ? y0 : cy > y1 ? y1 : cy;
  const dx = cx - px;
  const dy = cy - py;
  return dx * dx + dy * dy <= r * r;
}
