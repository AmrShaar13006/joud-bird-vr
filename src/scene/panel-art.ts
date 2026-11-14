// Drawing for the canvas panels. Arabic lines use direction = 'rtl'.
// Copy is a first draft: Amr to check the Arabic wording.

import type { DrawFn } from './canvas-panel';

export const COLORS = {
  panel: '#1d2b44',
  panelEdge: '#ffc94a',
  text: '#ffffff',
  muted: '#b9c6dc',
  accent: '#ffc94a',
};

const AR_FONT = "'Noto Sans Arabic', 'Noto Naskh Arabic', 'Segoe UI', Tahoma, sans-serif";
const LATIN_FONT = "'Segoe UI', Roboto, 'Noto Sans', Arial, sans-serif";

/** Input mode decides which hints we show. */
export type InputMode = 'xr' | 'desktop';

function background(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = COLORS.panel;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = COLORS.panelEdge;
  ctx.lineWidth = Math.max(4, h * 0.02);
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);
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

const startHint = (mode: InputMode) =>
  mode === 'xr' ? 'اضغط الزناد للبدء' : 'اضغط المسافة أو انقر للبدء';
const flapHint = (mode: InputMode) =>
  mode === 'xr' ? 'اضغط الزناد للطيران' : 'المسافة أو النقر للطيران';
const againHint = (mode: InputMode) =>
  mode === 'xr' ? 'اضغط الزناد أو A / X للعب مجددًا' : 'المسافة أو R للعب مجددًا';
const resumeHint = (mode: InputMode) =>
  mode === 'xr' ? 'اضغط الزناد أو B / Y للمتابعة' : 'المسافة أو Esc للمتابعة';

export function attractArt(best: number, mode: InputMode): DrawFn {
  return (ctx, w, h) => {
    background(ctx, w, h);
    line(ctx, 'Joud Bird', w / 2, h * 0.22, h * 0.2);
    line(ctx, 'طائر جود', w / 2, h * 0.42, h * 0.13, { ar: true, color: COLORS.accent });
    line(ctx, startHint(mode), w / 2, h * 0.62, h * 0.09, { ar: true });
    line(ctx, `أفضل نتيجة اليوم: ${best}`, w / 2, h * 0.82, h * 0.08, {
      ar: true,
      color: COLORS.muted,
    });
  };
}

export function readyArt(mode: InputMode): DrawFn {
  return (ctx, w, h) => {
    background(ctx, w, h);
    line(ctx, flapHint(mode), w / 2, h / 2, h * 0.45, { ar: true });
  };
}

export function gameOverArt(
  score: number,
  best: number,
  newBest: boolean,
  canRestart: boolean,
  mode: InputMode,
): DrawFn {
  return (ctx, w, h) => {
    background(ctx, w, h);
    line(ctx, 'انتهت الجولة', w / 2, h * 0.17, h * 0.13, { ar: true });
    line(ctx, String(score), w / 2, h * 0.4, h * 0.24, { color: COLORS.accent });
    line(
      ctx,
      newBest ? 'رقم قياسي جديد لليوم!' : `أفضل نتيجة اليوم: ${best}`,
      w / 2,
      h * 0.62,
      h * 0.08,
      { ar: true, color: newBest ? COLORS.accent : COLORS.muted },
    );
    line(ctx, againHint(mode), w / 2, h * 0.83, h * 0.08, {
      ar: true,
      color: canRestart ? COLORS.text : COLORS.panel, // hidden during the lockout
    });
  };
}

export function pausedArt(mode: InputMode): DrawFn {
  return (ctx, w, h) => {
    background(ctx, w, h);
    line(ctx, 'متوقف مؤقتًا', w / 2, h * 0.36, h * 0.26, { ar: true });
    line(ctx, resumeHint(mode), w / 2, h * 0.72, h * 0.16, { ar: true, color: COLORS.muted });
  };
}

export function scoreArt(score: number): DrawFn {
  return (ctx, w, h) => {
    background(ctx, w, h);
    line(ctx, String(score), w / 2, h / 2 + h * 0.03, h * 0.7);
  };
}

export function recentreArt(): DrawFn {
  return (ctx, w, h) => {
    ctx.fillStyle = '#34507d';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = COLORS.text;
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, w - 6, h - 6);
    line(ctx, 'إعادة التوسيط', w / 2, h * 0.38, h * 0.3, { ar: true });
    line(ctx, 'Recentre', w / 2, h * 0.75, h * 0.2, { color: COLORS.muted, weight: 'normal' });
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
