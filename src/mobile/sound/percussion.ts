// The percussion layer, drums only (Joud's rule: no melody, no instruments). One tempo.
// Under it, a garden bed: a soft breeze, and far-off birds once the score reaches 10.
// Score 0–9: breeze only. From 10: a soft frame-drum pulse. From 25: a full maqsum-style
// darbuka rhythm over it. PercussionLayer plays it during rounds (Joud approved the samples on
// 28 Nov 2026). Loaded after the first tap, never in the first load.

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

/** Seconds of drums scheduled ahead of the audio clock; each frame tops it up. */
export const AHEAD = 0.3;
/** The breeze plays in stretches this long, each overlapping the next by its 1.5 s fades. */
const GUST = BAR * 4;
/** Time constant of the fades (seconds): in over about a second, out in about half. */
const FADE_IN = 0.25;
const FADE_OUT = 0.12;

/** What the layer plays; tests swap these for recorders. */
export interface LayerVoices {
  bar: (k: Kit, t: number, layer: Layer) => void;
  breeze: (k: Kit, t: number, dur: number) => void;
}

/**
 * The layer during play. Call update() every frame: while `on` (a round is playing and the
 * switch is on) it keeps bars scheduled AHEAD seconds ahead, each at the layer the score calls
 * for when it is scheduled, so a change lands on the next bar. When `on` drops (pause, crash,
 * hidden tab, switch off) it fades out; the next start is a fresh chain from bar one, so notes
 * already scheduled on the faded chain stay silent.
 */
export class PercussionLayer {
  private chain: GainNode | null = null;
  private kit: Kit | null = null;
  private nextBar = 0;
  private nextGust = 0;

  constructor(
    private readonly base: Kit,
    private readonly voices: LayerVoices = { bar: (k, t, l) => scheduleBar(k, t, l), breeze },
  ) {}

  get playing(): boolean {
    return this.chain !== null;
  }

  update(on: boolean, score: number): void {
    const now = this.base.ctx.currentTime;
    if (!on) {
      if (this.chain) this.stop(now);
      return;
    }
    if (!this.chain) this.start(now);
    const k = this.kit!;
    while (this.nextGust < now + AHEAD) {
      this.voices.breeze(k, this.nextGust, GUST + 1.5);
      this.nextGust += GUST;
    }
    while (this.nextBar < now + AHEAD) {
      this.voices.bar(k, this.nextBar, layerFor(score));
      this.nextBar += BAR;
    }
  }

  private start(now: number): void {
    const g = this.base.ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.setTargetAtTime(1, now, FADE_IN);
    g.connect(this.base.out);
    this.chain = g;
    this.kit = { ...this.base, out: g };
    this.nextBar = this.nextGust = now + 0.05;
  }

  private stop(now: number): void {
    const g = this.chain!;
    g.gain.setTargetAtTime(0, now, FADE_OUT);
    // Free it once its last scheduled notes are over.
    setTimeout(() => g.disconnect(), (AHEAD + 1) * 1000);
    this.chain = this.kit = null;
  }
}
