import { bestStorageKey, parseBest } from '../core/best';

// localStorage can throw (blocked site data, private mode). The game must
// keep working without it, so every access is guarded.

export function loadBest(now = new Date()): number {
  try {
    return parseBest(window.localStorage.getItem(bestStorageKey(now)));
  } catch {
    return 0;
  }
}

export function saveBest(best: number, now = new Date()): void {
  try {
    window.localStorage.setItem(bestStorageKey(now), String(best));
  } catch {
    // ignore: best score just won't survive a reload
  }
}
