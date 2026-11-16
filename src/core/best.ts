import type { Mode } from './config';

// Best score of the day: key naming and parsing only. Storage itself
// (localStorage) belongs to the shell, which must survive it being blocked.

/** Local calendar day, e.g. "2026-11-17". */
export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function bestStorageKey(date: Date, mode: Mode): string {
  return `joudbird.best.${mode}.${dayKey(date)}`;
}

/** Parse a stored value; anything odd counts as 0. */
export function parseBest(raw: string | null | undefined): number {
  if (raw == null) return 0;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n < 100000 ? n : 0;
}
