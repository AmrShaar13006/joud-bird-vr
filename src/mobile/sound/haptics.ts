// Vibration on Android browsers. iPhone browsers have no navigator.vibrate: skipped silently.

export function vibrate(pattern: readonly number[]): void {
  try {
    navigator.vibrate?.(pattern as number[]);
  } catch {
    // blocked (no user gesture yet, or a policy): ignore
  }
}
