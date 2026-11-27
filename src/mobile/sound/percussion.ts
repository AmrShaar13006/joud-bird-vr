// The percussion layer, drums only (Joud's rule: no melody, no instruments). One tempo.
// Under it, a garden bed: a soft breeze, and far-off birds once the score reaches 10.
// Score 0–9: breeze only. From 10: a soft frame-drum pulse. From 25: a full maqsum-style
// darbuka rhythm over it. PR 1 uses it only for the debug sampler's preview and the
// offline renders; PR 2 schedules it during play, after Joud approves the samples.

import { breeze, distantBird, doum, frameDrum, type Kit, tek } from './voices';

export const BPM = 96;
/** One eighth note, in seconds. */
export const STEP = 60 / BPM / 2;
/** One bar of 4/4 = 8 eighths. */
export const BAR = STEP * 8;

export type Layer = 0 | 1 | 2;

/** The layer a score calls for. */
export function layerFor(score: number): Layer {
  return score >= 25 ? 2 : score >= 10 ? 1 : 0;
}

/** Maqsum in eighths: D T . T D . T . (D = doum, T = tek). */
export const MAQSUM = 'DT.TD.T.';
/** Frame drum on beats 1 and 3. */
export const PULSE = 'F...F...';

/** The layer sits under the effects: about 4 dB below them. */
const BED = 0.6;

/** Schedule one bar of `layer` starting at `t`. `rand` gives numbers in [0, 1). */
export function scheduleBar(k: Kit, t: number, layer: Layer, rand: () => number = Math.random): void {
  if (layer === 0) return;
  // One or two far-off birds a bar, at loose times.
  distantBird(k, t + rand() * BAR * 0.5, rand());
  if (layer === 2) distantBird(k, t + BAR * 0.5 + rand() * BAR * 0.4, rand());
  for (let i = 0; i < 8; i++) {
    const at = t + i * STEP;
    if (PULSE[i] === 'F') frameDrum(k, at, BED * (layer === 2 ? 0.8 : 1));
    if (layer === 2) {
      if (MAQSUM[i] === 'D') doum(k, at, BED * 0.75);
      else if (MAQSUM[i] === 'T') tek(k, at, BED * (i === 1 ? 0.55 : 0.7));
    }
  }
}

/**
 * The 20-second preview for Joud: the breeze throughout; 2 bars of it alone (score 0),
 * 3 bars with the frame drum and far birds (score 10), 3 bars with the full rhythm (score 25).
 * Returns its length in seconds.
 */
export function schedulePreview(k: Kit, t: number): number {
  const layers: Layer[] = [0, 0, 1, 1, 1, 2, 2, 2];
  const dur = layers.length * BAR;
  breeze(k, t, dur);
  layers.forEach((layer, i) => scheduleBar(k, t + i * BAR, layer));
  return dur;
}
