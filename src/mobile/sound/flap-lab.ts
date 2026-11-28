// Flap ideas on trial (28 Nov 2026): each one reacts to Joud's flight, so the tap tells the
// player something. Loaded lazily by the debug sampler (?debug=1&sounds=1&flap=<name>) and by
// the offline renders; never part of the normal page. Once Amr picks one, it moves into
// voices.ts and this file goes.
//
// What a voice is told about the flap (FlapInfo, from the engine): Joud's height in the lane,
// -1 (floor) to 1 (top), and the seconds since the last flap, which give its weight.

import type { FlapInfo } from './director';
import type { Kit } from './voices';

type Flap = { alt: number; weight: number };
type Voice = (k: Kit, t: number, rate: number, f: Flap) => void;
export type LabVoice = (k: Kit, t: number, rate: number, f: FlapInfo) => void;

/** How hard Joud flaps: 0 after a quick tap, 1 after a long fall (0.8 s or more); 0.5 for the first. */
export function flapWeight(since: number): number {
  return since < 0 ? 0.5 : Math.min(1, Math.max(0, (since - 0.2) / 0.6));
}

/**
 * Pitch follows height: up to 6 semitones lower at the floor and higher at the top. Joud mostly
 * flies in the middle third, where it moves about 2 semitones either way.
 */
const sky = (alt: number): number => Math.pow(2, (Math.max(-1, Math.min(1, alt)) * 6) / 12);

function env(k: Kit, t: number, peak: number, attack: number, decay: number): GainNode {
  const g = k.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(k.out);
  return g;
}

/** One oscillator bending f0 → f1 over `glide` seconds. Returns it, so callers can modulate it. */
function bend(k: Kit, t: number, type: OscillatorType, f0: number, f1: number, glide: number, peak: number, attack: number, decay: number): OscillatorNode {
  const o = k.ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + glide);
  o.connect(env(k, t, peak, attack, decay));
  o.start(t);
  o.stop(t + attack + decay + 0.02);
  return o;
}

/** A tiny bird syllable: f0 → peak → end with a throat warble, and a quiet octave. */
function syllable(k: Kit, t: number, f0: number, peak: number, end: number, dur: number, level: number): void {
  const c = k.ctx;
  const o = c.createOscillator();
  const h = c.createOscillator();
  for (const [osc, m] of [[o, 1], [h, 2]] as const) {
    osc.frequency.setValueAtTime(f0 * m, t);
    osc.frequency.exponentialRampToValueAtTime(peak * m, t + dur * 0.35);
    osc.frequency.exponentialRampToValueAtTime(end * m, t + dur);
  }
  const lfo = c.createOscillator();
  lfo.frequency.value = 55;
  const depth = c.createGain();
  depth.gain.value = peak * 0.04;
  lfo.connect(depth).connect(o.frequency);
  o.connect(env(k, t, level, dur * 0.15, dur * 0.85));
  h.connect(env(k, t, level * 0.1, dur * 0.15, dur * 0.6));
  for (const n of [o, h, lfo]) {
    n.start(t);
    n.stop(t + dur + 0.03);
  }
}

/**
 * 1. Dew drop (قطرة ندى): a clear "plip" from the garden, a sine that rises fast like a drop
 * landing in water, with a smaller second drop. Its pitch follows Joud's height, so the player
 * hears how high Joud is; a long fall makes a fuller drop.
 */
const drop: Voice = (k, t, rate, f) => {
  const s = rate * sky(f.alt);
  const L = 0.2 * (0.85 + 0.3 * f.weight);
  bend(k, t, 'sine', 640 * s, 1500 * s, 0.032, L, 0.002, 0.07 + 0.03 * f.weight);
  bend(k, t + 0.03, 'sine', 1350 * s, 2350 * s, 0.022, L * 0.22, 0.002, 0.045);
};

/**
 * 2. Joud's chatter (ثرثرة جود): every flap is one tiny syllable of Joud's voice, four
 * kinds, never the same twice in a row, so a run of taps sounds like Joud talking, not a
 * machine. Pitch follows height; quick taps make quicker, excited syllables. A soft low tap
 * under it keeps the touch feeling solid.
 */
let lastSyllable = 0;
const chatter: Voice = (k, t, rate, f) => {
  const b = 2150 * rate * sky(f.alt);
  const d = f.weight < 0.15 ? 0.8 : 1;
  const L = 0.24;
  const pick = (lastSyllable + 1 + Math.floor(Math.random() * 3)) % 4;
  lastSyllable = pick;
  switch (pick) {
    case 0: // "wit", rising
      syllable(k, t, b * 0.8, b * 1.1, b * 1.04, 0.055 * d, L);
      break;
    case 1: // "tew", falling
      syllable(k, t, b * 1.08, b * 1.18, b * 0.8, 0.06 * d, L);
      break;
    case 2: // "chi-chi"
      syllable(k, t, b, b * 1.14, b * 0.96, 0.032 * d, L * 0.85);
      syllable(k, t + 0.048 * d, b * 1.05, b * 1.22, b * 1.02, 0.032 * d, L * 0.85);
      break;
    default: // "tsip", a quick flick up
      syllable(k, t, b * 0.92, b * 1.32, b * 1.26, 0.038 * d, L);
  }
  bend(k, t, 'sine', 470 * rate, 610 * rate, 0.03, 0.09, 0.003, 0.04);
};

/**
 * 3. Bubble pop (فقاعة): a crisp, tactile "pok", like popping bubble wrap. Its size follows
 * how far Joud fell before the tap: catching a long fall is a big round pop, quick taps are
 * small light ones.
 */
const pop: Voice = (k, t, rate, f) => {
  const w = f.weight;
  const s = rate * (1.08 - 0.16 * w);
  bend(k, t, 'sine', 2500 * s, 950 * s, 0.01, 0.08, 0.001, 0.016);
  bend(k, t + 0.003, 'triangle', 980 * s, 690 * s, 0.03, 0.23 + 0.09 * w, 0.002, 0.045 + 0.045 * w);
};

/**
 * 4. Spring hop (نطّة): Joud bounces up like a soft spring, a rising tone with a wobble that
 * settles. A long fall gives a bigger bounce; pitch follows height.
 */
const spring: Voice = (k, t, rate, f) => {
  const w = f.weight;
  const s = rate * sky(f.alt);
  const top = 640 * s;
  const dur = 0.12 + 0.08 * w;
  const c = k.ctx;
  const lfo = c.createOscillator();
  lfo.frequency.value = 15;
  // The wobble, on the tone and (twice as deep) on its octave.
  for (const m of [1, 2]) {
    const o = bend(k, t, 'sine', 380 * s * m, top * m, 0.05, (m === 1 ? 0.15 : 0.04) * (1 + 0.25 * w), 0.004, dur / m);
    const depth = c.createGain();
    depth.gain.setValueAtTime(top * m * (0.035 + 0.045 * w), t);
    depth.gain.exponentialRampToValueAtTime(1, t + dur);
    lfo.connect(depth).connect(o.frequency);
  }
  lfo.start(t);
  lfo.stop(t + dur + 0.03);
};

const weighed =
  (v: Voice): LabVoice =>
  (k, t, rate, f) =>
    v(k, t, rate, { alt: f.alt, weight: flapWeight(f.since) });

/** The trial voices, in the order of the samples. */
export const LAB_VOICES: Record<string, LabVoice> = {
  drop: weighed(drop),
  chatter: weighed(chatter),
  pop: weighed(pop),
  spring: weighed(spring),
};
