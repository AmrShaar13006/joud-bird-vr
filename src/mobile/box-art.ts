// Campaign box faces for the phone lane: one canvas atlas, drawn once at start.
// Motifs and colours come only from docs/joud-brand.md and the brand box page:
//   red-orange boxes with the words أنا / ادّعـــم / جـــود in butter (kashida as on the boxes),
//   deep-green boxes with painted flowers and leaves, butter boxes with crescent moons and
//   four-point sparkles. Flat colour, no gradients, no gloss.
// Arabic is drawn on a 2D canvas (CLAUDE.md), in the system font (no DG Mataryah files).
// The tile picking and UV maths below are pure, so they are unit-tested in Node.

import { BRAND } from '../scene/scenery';

export const ATLAS_COLS = 4;
export const ATLAS_ROWS = 4;
/** Tile aspect = the box face in the lane (0.09 wide × 0.056 tall), so nothing is squashed. */
export const TILE_W = 256;
export const TILE_H = 160;

/** Word tiles, top to bottom as the phrase reads on a column of boxes. */
export const WORD_TILES = [0, 1, 2] as const;
const WORDS = ['أنا', 'ادّعـــم', 'جـــود'];

/** Decorative tiles by colour family (index = family). */
const FAMILIES: readonly (readonly number[])[] = [
  [8, 9, 10, 11, 12, 13], // butter: moons, sparkles, flowers
  [4, 5, 6, 7, 14], // deep green: flowers, leaves, a moon
  [3, 15], // red-orange: flower, leaves
];

export type Column = 'upper' | 'lower' | 'middle';

/**
 * Face for the k-th box of a column (k = 0 at the gap). On one column per obstacle (upper for
 * even pool slots, lower for odd ones) the three boxes next to the gap read أنا / ادّعم / جود
 * from top to bottom. Every other box is decorative, alternating colour families.
 */
export function boxTile(slot: number, k: number, column: Column): number {
  const words = column === (slot % 2 === 0 ? 'upper' : 'lower');
  if (words && k < 3) return column === 'upper' ? WORD_TILES[2 - k] : WORD_TILES[k];
  const fam = FAMILIES[(slot + k + (column === 'lower' ? 1 : 0)) % FAMILIES.length];
  return fam[(slot * 5 + k * 3) % fam.length];
}

/**
 * UV rectangle [u0, v0, width, height] of a tile, for a box showing `frac` (0–1] of its face.
 * `keepTop`: a box clipped at its lower edge keeps the top of its face, else the bottom.
 * Inset by `insetPx` atlas pixels so mipmaps never pick up a neighbour tile.
 */
export function tileRect(tile: number, frac: number, keepTop: boolean, insetPx = 4): [number, number, number, number] {
  const col = tile % ATLAS_COLS;
  const row = Math.floor(tile / ATLAS_COLS);
  const iu = insetPx / (TILE_W * ATLAS_COLS);
  const iv = insetPx / (TILE_H * ATLAS_ROWS);
  const u0 = col / ATLAS_COLS + iu;
  const uw = 1 / ATLAS_COLS - 2 * iu;
  // Canvas textures are flipped: canvas row 0 is the top of the texture (v = 1).
  const v0 = 1 - (row + 1) / ATLAS_ROWS + iv;
  const vh = 1 / ATLAS_ROWS - 2 * iv;
  const f = Math.min(1, Math.max(0, frac));
  return [u0, keepTop ? v0 + (1 - f) * vh : v0, uw, f * vh];
}

// ---------- drawing (browser only) ----------

const FONT = "'Segoe UI', Tahoma, system-ui, -apple-system, sans-serif";

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sparkle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  const w = r * 0.3;
  ctx.fillStyle = color;
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
  ctx.fill();
}

function moon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, bg: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(x + r * 0.45, y - r * 0.25, r * 0.86, 0, Math.PI * 2);
  ctx.fill();
}

function leaf(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, rot: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(len / 2, 0, len / 2, len * 0.17, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function flower(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, petal: string, centre: string): void {
  ctx.fillStyle = petal;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.46, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = centre;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.34, 0, Math.PI * 2);
  ctx.fill();
}

/** A stem with leaves and a flower head standing on the tile's bottom edge. */
function plant(ctx: CanvasRenderingContext2D, x: number, h: number, size: number, petal: string, r: () => number): void {
  const top = TILE_H - h;
  ctx.strokeStyle = BRAND.leafGreen;
  ctx.lineWidth = Math.max(2, size * 0.12);
  ctx.beginPath();
  ctx.moveTo(x, TILE_H);
  ctx.lineTo(x + (r() - 0.5) * 8, top);
  ctx.stroke();
  leaf(ctx, x, TILE_H - h * 0.35, size * 1.1, -Math.PI * (0.15 + r() * 0.2), BRAND.leafGreen);
  leaf(ctx, x, TILE_H - h * 0.55, size * 0.9, -Math.PI * (0.8 + r() * 0.1), BRAND.leafGreen);
  flower(ctx, x, top, size * 0.7, petal, BRAND.orange);
}

function wordTile(ctx: CanvasRenderingContext2D, word: string, r: () => number): void {
  ctx.fillStyle = BRAND.redOrange;
  ctx.fillRect(0, 0, TILE_W, TILE_H);
  sparkle(ctx, TILE_W * 0.1, TILE_H * 0.22, 9, BRAND.leafGreen);
  sparkle(ctx, TILE_W * 0.9, TILE_H * 0.8, 7, BRAND.cream);
  if (r() > 0.5) moon(ctx, TILE_W * 0.86, TILE_H * 0.2, 10, BRAND.peach, BRAND.redOrange);
  ctx.fillStyle = BRAND.butter;
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = TILE_H * 0.62;
  ctx.font = `800 ${size}px ${FONT}`;
  const maxW = TILE_W * 0.8;
  const w = ctx.measureText(word).width;
  if (w > maxW) {
    size *= maxW / w;
    ctx.font = `800 ${size}px ${FONT}`;
  }
  ctx.fillText(word, TILE_W / 2, TILE_H * 0.5);
}

function greenTile(ctx: CanvasRenderingContext2D, variant: number, r: () => number): void {
  ctx.fillStyle = BRAND.deepGreen;
  ctx.fillRect(0, 0, TILE_W, TILE_H);
  const petals = [BRAND.redOrange, BRAND.rose, BRAND.sky, BRAND.rose];
  for (let i = 0; i < 6; i++) leaf(ctx, r() * TILE_W, TILE_H * (0.55 + r() * 0.5), 30 + r() * 26, -Math.PI * (0.2 + r() * 0.6), BRAND.leafGreen);
  const n = 2 + (variant % 2);
  for (let i = 0; i < n; i++) {
    const x = TILE_W * ((i + 0.5) / n) + (r() - 0.5) * 30;
    plant(ctx, x, TILE_H * (0.45 + r() * 0.3), 30 + r() * 10, petals[(variant + i) % petals.length], r);
  }
  sparkle(ctx, TILE_W * (0.15 + r() * 0.7), TILE_H * 0.18, 8, BRAND.butter);
}

function butterTile(ctx: CanvasRenderingContext2D, variant: number, r: () => number): void {
  ctx.fillStyle = BRAND.butter;
  ctx.fillRect(0, 0, TILE_W, TILE_H);
  if (variant < 4) {
    moon(ctx, TILE_W * (0.2 + 0.6 * ((variant * 0.37) % 1)), TILE_H * 0.35, 20, BRAND.orange, BRAND.butter);
    const colors = [BRAND.redOrange, BRAND.deepGreen, BRAND.sky, BRAND.brick];
    for (let i = 0; i < 4; i++) sparkle(ctx, TILE_W * (0.1 + r() * 0.8), TILE_H * (0.2 + r() * 0.65), 8 + r() * 8, colors[(i + variant) % colors.length]);
  } else {
    plant(ctx, TILE_W * 0.3, TILE_H * 0.6, 34, variant % 2 ? BRAND.rose : BRAND.redOrange, r);
    plant(ctx, TILE_W * 0.72, TILE_H * 0.45, 28, BRAND.sky, r);
    sparkle(ctx, TILE_W * 0.52, TILE_H * 0.22, 9, BRAND.redOrange);
  }
}

function redTile(ctx: CanvasRenderingContext2D, variant: number, r: () => number): void {
  ctx.fillStyle = BRAND.redOrange;
  ctx.fillRect(0, 0, TILE_W, TILE_H);
  if (variant === 0) {
    plant(ctx, TILE_W * 0.5, TILE_H * 0.55, 36, BRAND.rose, r);
    sparkle(ctx, TILE_W * 0.2, TILE_H * 0.3, 9, BRAND.butter);
    sparkle(ctx, TILE_W * 0.82, TILE_H * 0.42, 7, BRAND.leafGreen);
  } else {
    for (let i = 0; i < 5; i++) leaf(ctx, r() * TILE_W, TILE_H * (0.6 + r() * 0.4), 34 + r() * 20, -Math.PI * (0.2 + r() * 0.6), BRAND.deepGreen);
    moon(ctx, TILE_W * 0.7, TILE_H * 0.32, 15, BRAND.butter, BRAND.redOrange);
  }
}

/** Darker band along the bottom of every face: stacked boxes read as boxes. */
function shade(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
  ctx.fillRect(0, TILE_H * 0.9, TILE_W, TILE_H * 0.1);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.fillRect(0, 0, TILE_W, TILE_H * 0.04);
}

/** Draws the 4 × 4 atlas. `scale` 0.5 halves its resolution (low tier). */
export function drawBoxAtlas(scale = 1): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(TILE_W * ATLAS_COLS * scale);
  canvas.height = Math.round(TILE_H * ATLAS_ROWS * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const r = rng(2611);
  for (let t = 0; t < ATLAS_COLS * ATLAS_ROWS; t++) {
    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate((t % ATLAS_COLS) * TILE_W, Math.floor(t / ATLAS_COLS) * TILE_H);
    ctx.beginPath();
    ctx.rect(0, 0, TILE_W, TILE_H);
    ctx.clip();
    if (t < 3) wordTile(ctx, WORDS[t], r);
    else if (t === 3) redTile(ctx, 0, r);
    else if (t < 8) greenTile(ctx, t - 4, r);
    else if (t < 14) butterTile(ctx, t - 8, r);
    else if (t === 14) {
      ctx.fillStyle = BRAND.deepGreen;
      ctx.fillRect(0, 0, TILE_W, TILE_H);
      moon(ctx, TILE_W * 0.3, TILE_H * 0.4, 22, BRAND.butter, BRAND.deepGreen);
      sparkle(ctx, TILE_W * 0.62, TILE_H * 0.3, 10, BRAND.cream);
      sparkle(ctx, TILE_W * 0.8, TILE_H * 0.65, 7, BRAND.rose);
    } else redTile(ctx, 1, r);
    shade(ctx);
    ctx.restore();
  }
  return canvas;
}
