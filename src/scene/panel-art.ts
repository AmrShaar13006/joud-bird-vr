// Drawing for the canvas panels. Arabic lines use direction = 'rtl'.
// All words come from strings.ts.

import type { Mode } from '../core/config';
import type { DrawFn } from './canvas-panel';
import { type InputMode, STRINGS as S } from './strings';

export type { InputMode };

// Campaign colour blocks (docs/joud-brand.md): deep green or red-orange with cream text.
export const COLORS = {
  panel: '#085828',
  panelAlt: '#E84818',
  text: '#F8E8C8',
  muted: '#D9E7C9',
  accent: '#F8E888',
  rose: '#D87888',
};

let panelFx = true;
/** Sparkle accents on the panels follow ?fx (default on). */
export function setPanelFx(on: boolean): void {
  panelFx = on;
}

/** Four-point star, the campaign's sparkle. */
function sparkle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  const w = r * 0.28;
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
  ctx.fillStyle = color;
  ctx.fill();
}

/** A few corner sparkles (static) when effects are on. */
function cornerSparkles(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  if (!panelFx) return;
  const r = h * 0.06;
  sparkle(ctx, w * 0.06, h * 0.14, r, COLORS.accent);
  sparkle(ctx, w * 0.11, h * 0.28, r * 0.55, COLORS.text);
  sparkle(ctx, w * 0.94, h * 0.84, r, COLORS.accent);
  sparkle(ctx, w * 0.89, h * 0.7, r * 0.55, COLORS.rose);
}

const AR_FONT = "'Noto Sans Arabic', 'Noto Naskh Arabic', 'Segoe UI', Tahoma, sans-serif";
const LATIN_FONT = "'Segoe UI', Roboto, 'Noto Sans', Arial, sans-serif";

/** Solid colour block; no outline, no gradient. */
function background(ctx: CanvasRenderingContext2D, w: number, h: number, fill = COLORS.panel): void {
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, w, h);
}

function line(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  opts: { ar?: boolean; color?: string; weight?: string } = {},
): void {
  ctx.font = `${opts.weight ?? 'bold'} ${Math.round(size)}px ${opts.ar ? AR_FONT : LATIN_FONT}`;
  ctx.direction = opts.ar ? 'rtl' : 'ltr';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = opts.color ?? COLORS.text;
  ctx.fillText(text, x, y);
}

export function attractArt(best: number, input: InputMode, picker: boolean): DrawFn {
  return (ctx, w, h) => {
    background(ctx, w, h);
    cornerSparkles(ctx, w, h);
    line(ctx, S.title, w / 2, h * 0.17, h * 0.17);
    line(ctx, S.mascot, w / 2, h * 0.36, h * 0.12, { ar: true, color: COLORS.accent });
    line(ctx, S.start[input], w / 2, h * 0.55, h * 0.085, { ar: true });
    line(ctx, S.bestToday(best), w / 2, h * 0.71, h * 0.075, { ar: true, color: COLORS.muted });
    if (picker) line(ctx, S.chooseMode, w / 2, h * 0.87, h * 0.07, { ar: true, color: COLORS.accent });
  };
}

export function readyArt(input: InputMode): DrawFn {
  return (ctx, w, h) => {
    background(ctx, w, h);
    line(ctx, S.flap[input], w / 2, h / 2, h * 0.45, { ar: true });
  };
}

export function gameOverArt(
  score: number,
  best: number,
  newBest: boolean,
  canRestart: boolean,
  mode: Mode,
  input: InputMode,
): DrawFn {
  return (ctx, w, h) => {
    background(ctx, w, h, COLORS.panelAlt);
    cornerSparkles(ctx, w, h);
    line(ctx, S.roundOver, w / 2, h * 0.14, h * 0.12, { ar: true });
    line(ctx, String(score), w / 2, h * 0.35, h * 0.22, { color: COLORS.accent });
    line(ctx, newBest ? S.newBest : S.bestToday(best), w / 2, h * 0.55, h * 0.075, {
      ar: true,
      color: newBest ? COLORS.accent : COLORS.text,
    });
    line(ctx, S.modeLine(mode), w / 2, h * 0.69, h * 0.07, { ar: true, color: COLORS.text });
    line(ctx, S.again[input], w / 2, h * 0.85, h * 0.08, {
      ar: true,
      color: canRestart ? COLORS.text : COLORS.panelAlt, // hidden during the lockout
    });
  };
}

export function pausedArt(input: InputMode): DrawFn {
  return (ctx, w, h) => {
    background(ctx, w, h);
    line(ctx, S.paused, w / 2, h * 0.36, h * 0.26, { ar: true });
    line(ctx, S.resume[input], w / 2, h * 0.72, h * 0.16, { ar: true, color: COLORS.muted });
  };
}

export function scoreArt(score: number): DrawFn {
  return (ctx, w, h) => {
    background(ctx, w, h, COLORS.panelAlt);
    line(ctx, String(score), w / 2, h / 2 + h * 0.03, h * 0.7);
  };
}

/** One mode button. Selected = filled; the desktop key shows underneath. */
export function modeButtonArt(mode: Mode, selected: boolean, input: InputMode): DrawFn {
  return (ctx, w, h) => {
    // Selected: red-orange block with a butter edge; others: deep green.
    ctx.fillStyle = selected ? COLORS.panelAlt : COLORS.panel;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = selected ? COLORS.accent : COLORS.text;
    ctx.lineWidth = selected ? 16 : 6;
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);
    const ink = COLORS.text;
    const y = input === 'desktop' ? h * 0.42 : h * 0.52;
    line(ctx, S.modeName[mode], w / 2, y, h * 0.5, { ar: true, color: ink });
    if (input === 'desktop') line(ctx, S.modeKey[mode], w / 2, h * 0.82, h * 0.2, { color: ink });
  };
}

export function recentreArt(): DrawFn {
  return (ctx, w, h) => {
    ctx.fillStyle = COLORS.panel;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = COLORS.text;
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, w - 6, h - 6);
    line(ctx, S.recentre, w / 2, h * 0.38, h * 0.3, { ar: true });
    line(ctx, S.recentreLatin, w / 2, h * 0.75, h * 0.2, { color: COLORS.muted, weight: 'normal' });
  };
}

export function hudArt(lines: readonly string[]): DrawFn {
  return (ctx, w, h) => {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
    ctx.font = `${Math.round(h / 11)}px monospace`;
    ctx.direction = 'ltr';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#7CFC00';
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], 10, 8 + i * (h / 10));
  };
}
