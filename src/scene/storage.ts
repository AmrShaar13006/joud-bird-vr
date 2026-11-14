import { bestStorageKey, parseBest } from '../core/best';
import type { Mode } from '../core/config';

// localStorage can throw (blocked site data, private mode). The game must
// keep working without it, so every access is guarded.
// Best scores are kept per mode per day.

export function loadBest(mode: Mode, now = new Date()): number {
  try {
    return parseBest(window.localStorage.getItem(bestStorageKey(now, mode)));
  } catch {
    return 0;
  }
}

export function saveBest(mode: Mode, best: number, now = new Date()): void {
  try {
    window.localStorage.setItem(bestStorageKey(now, mode), String(best));
  } catch {
    // ignore: best score just won't survive a reload
  }
}
