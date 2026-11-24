// Obstacle cues for the phone lane: a round badge on the box just above a gap that pays more
// than a plain gate, so players can see +2 / +3 / +5 coming. Values come from the ruleset's
// points table, so a badge can never disagree with the score. Badges echo the booth signs:
// a butter disc with a deep-green rim; the risky side of a fork is a red-orange disc with two
// sparkles at its lips. Read-only over core state; the pure parts are unit-tested in Node.

import type { Obstacle } from '../core/obstacles';
import type { PointsTable } from '../core/ruleset';
import { BRAND } from '../scene/scenery';

export interface Cue {
  /** Points the marked gap pays. */
  value: number;
  /** The gap moves up and down. */
  moving: boolean;
  /** The risky (narrow) side of a fork: the badge sits above `gap2`. */
  risky: boolean;
}

/** The cue for an obstacle, or null for a plain gate (and a fork's safe side). */
export function cueFor(o: Pick<Obstacle, 'kind'>, points: Readonly<PointsTable>): Cue | null {
  switch (o.kind) {
    case 'gate':
      return null;
    case 'fork':
      return { value: points.forkRisky, moving: false, risky: true };
    case 'moving':
      return { value: points.moving, moving: true, risky: false };
    default:
      return { value: points[o.kind], moving: false, risky: false };
  }
}

/** Badges that look the same share one atlas tile. */
export function badgeKey(c: Cue): string {
  return `${c.value}${c.moving ? 'm' : ''}${c.risky ? 'r' : ''}`;
}

export function badgeLabel(c: Cue): string {
  return `+${c.value}`;
}

// ---------- atlas (browser only) ----------

export const BADGE_COLS = 4;
export const BADGE_ROWS = 2;
const TILE = 128;
/** The last tile is the sparkle used at a risky gap's lips. */
export const SPARKLE_TILE = BADGE_COLS * BADGE_ROWS - 1;

/** UV rectangle [u0, v0, width, height] of a badge-atlas tile (canvas textures are flipped). */
export function badgeRect(
  tile: number,
  out: [number, number, number, number] = [0, 0, 0, 0],
): [number, number, number, number] {
  const col = tile % BADGE_COLS;
  const row = Math.floor(tile / BADGE_COLS);
  out[0] = col / BADGE_COLS;
  out[1] = 1 - (row + 1) / BADGE_ROWS;
  out[2] = 1 / BADGE_COLS;
  out[3] = 1 / BADGE_ROWS;
  return out;
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  const w = r * 0.3;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + w, y - w);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x + w, y + w);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - w, y + w);
  ctx.lineTo(x - r, y);
  ctx.lineTo(x - w, y - w);
  ctx.closePath();
}

function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, up: boolean): void {
  const d = up ? -1 : 1;
  ctx.beginPath();
  ctx.moveTo(x, y + d * s);
  ctx.lineTo(x + s, y);
  ctx.lineTo(x - s, y);
  ctx.closePath();
  ctx.fill();
}

/**
 * Draws one tile per distinct cue (at most SPARKLE_TILE of them) plus the sparkle tile.
 * Returns the canvas and the tile index of each badge key.
 */
export function drawBadgeAtlas(cues: readonly Cue[]): { canvas: HTMLCanvasElement; tiles: Map<string, number> } {
  const canvas = document.createElement('canvas');
  canvas.width = TILE * BADGE_COLS;
  canvas.height = TILE * BADGE_ROWS;
  const tiles = new Map<string, number>();
  const ctx = canvas.getContext('2d');
  if (!ctx) return { canvas, tiles };
  const font = "'Segoe UI', Tahoma, system-ui, -apple-system, sans-serif";
  for (const c of cues) {
    const key = badgeKey(c);
    if (tiles.has(key) || tiles.size >= SPARKLE_TILE) continue;
    const t = tiles.size;
    tiles.set(key, t);
    const cx = (t % BADGE_COLS) * TILE + TILE / 2;
    const cy = Math.floor(t / BADGE_COLS) * TILE + TILE / 2;
    const fill = c.risky ? BRAND.redOrange : BRAND.butter;
    const ink = c.risky ? BRAND.butter : BRAND.deepGreen;
    ctx.fillStyle = c.risky ? BRAND.butter : BRAND.deepGreen;
    ctx.beginPath();
    ctx.arc(cx, cy, TILE * 0.47, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(cx, cy, TILE * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction = 'ltr';
    ctx.font = `800 ${c.moving ? 40 : 52}px ${font}`;
    ctx.fillText(badgeLabel(c), cx, cy + 2);
    if (c.moving) {
      arrow(ctx, cx, cy - 30, 9, true);
      arrow(ctx, cx, cy + 31, 9, false);
    }
  }
  // Sparkle: butter with a deep-green edge, readable on any box colour.
  const sx = (SPARKLE_TILE % BADGE_COLS) * TILE + TILE / 2;
  const sy = Math.floor(SPARKLE_TILE / BADGE_COLS) * TILE + TILE / 2;
  ctx.fillStyle = BRAND.deepGreen;
  star(ctx, sx, sy, TILE * 0.47);
  ctx.fill();
  ctx.fillStyle = BRAND.butter;
  star(ctx, sx, sy, TILE * 0.36);
  ctx.fill();
  return { canvas, tiles };
}
