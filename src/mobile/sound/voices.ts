// Every sound of the phone game, synthesised with Web Audio: no files, no instruments. The
// sound world is a garden: Joud's chirps, the first version's flap, sparkles and drums, and the score chime
// that climbs a pentatonic scale with each point of a run (as in the first version; Joud
// approved the climb on 28 Nov 2026). Each voice draws into a Kit, so the
// same code plays live in the game and renders offline to .wav (scripts/sound/render-samples.mjs).

/** Where a voice plays: a (live or offline) context, its bus and a shared noise buffer. */
export interface Kit {
  ctx: BaseAudioContext;
  out: AudioNode;
  noise: AudioBuffer;
}

/**
 * Gain of each voice, tuned with `npm run sound:samples` so the effects land near the same
 * loudness in the game. The flap keeps the first version's balance with the chime (its peak a
 * little above the chime's); the button tick sits lower. Change loudness here only.
 */
export const LOUD = {
  flap: 0.33,
  ruffle: 0.5,
  chime: 0.3,
  chirp: 0.16,
  glint: 0.1,
  thump: 0.38,
  tek: 0.27,
  doum: 0.4,
  tick: 0.11,
  frame: 0.32,
  breeze: 0.05,
} as const;

/** Flap voices: a setting, so flap-sound items can add more later. 'classic' is the first version's. */
export const FLAP_VOICES = ['classic'] as const;
export type FlapVoice = (typeof FLAP_VOICES)[number];

/** The chime's first pitch (as the first version). */
const CHIME_HZ = 660;
/** Pentatonic steps in semitones: the chime climbs these with the points of a run, then repeats. */
export const CHIME_STEPS = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24] as const;

/** Pitch factor of the chime for the `n`-th point of a run (1 = the first). */
export function chimeStep(n: number): number {
  return Math.pow(2, CHIME_STEPS[Math.max(0, n - 1) % CHIME_STEPS.length] / 12);
}

/** 0.3 s of white noise, made once per context. */
export function makeNoise(ctx: BaseAudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * 0.3);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/** An attack/decay gain envelope that starts at `t`, wired to `out`. */
function env(k: Kit, t: number, peak: number, attack: number, decay: number): GainNode {
  const g = k.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(k.out);
  return g;
}

/** An oscillator gliding f0 → f1 over `glide` seconds. */
function tone(k: Kit, t: number, type: OscillatorType, f0: number, f1: number, glide: number, peak: number, attack: number, decay: number): void {
  const o = k.ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + glide);
  o.connect(env(k, t, peak, attack, decay));
  o.start(t);
  o.stop(t + attack + decay + 0.02);
}

/** Filtered noise burst. `sweep` glides the filter to that frequency. */
function noise(k: Kit, t: number, type: BiquadFilterType, freq: number, q: number, peak: number, decay: number, sweep = freq, attack = 0.003): void {
  const src = k.ctx.createBufferSource();
  src.buffer = k.noise;
  const f = k.ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (sweep !== freq) f.frequency.exponentialRampToValueAtTime(sweep, t + attack + decay);
  src.connect(f).connect(env(k, t, peak, attack, decay));
  src.start(t);
  src.stop(t + attack + decay + 0.03);
}

/**
 * One bird chirp: a pure tone that swoops f0 → peak → end, with a fast warble (the throat's
 * flutter) and a quiet octave for brightness. `dur` in seconds.
 */
function chirp(k: Kit, t: number, f0: number, peak: number, end: number, dur: number, level = 1, warble = 0.06): void {
  const c = k.ctx;
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(peak, t + dur * 0.35);
  o.frequency.exponentialRampToValueAtTime(end, t + dur);
  const lfo = c.createOscillator();
  lfo.frequency.value = 55;
  const depth = c.createGain();
  depth.gain.value = peak * warble;
  lfo.connect(depth).connect(o.frequency);
  const g = env(k, t, LOUD.chirp * level, dur * 0.15, dur * 0.85);
  o.connect(g);
  const h = c.createOscillator();
  h.type = 'sine';
  h.frequency.setValueAtTime(f0 * 2, t);
  h.frequency.exponentialRampToValueAtTime(peak * 2, t + dur * 0.35);
  h.frequency.exponentialRampToValueAtTime(end * 2, t + dur);
  h.connect(env(k, t, LOUD.chirp * 0.12 * level, dur * 0.15, dur * 0.6));
  for (const n of [o, lfo, h]) {
    n.start(t);
    n.stop(t + dur + 0.03);
  }
}

// ---------- drums (percussion layer and the new-best ending) ----------

/** Darbuka low stroke. */
export function doum(k: Kit, t: number, level = 1): void {
  tone(k, t, 'sine', 190, 72, 0.22, LOUD.doum * level, 0.004, 0.34);
  noise(k, t, 'lowpass', 900, 0.7, LOUD.doum * 0.25 * level, 0.03);
}

/** Darbuka high stroke. */
export function tek(k: Kit, t: number, level = 1): void {
  noise(k, t, 'bandpass', 3400, 1.4, LOUD.tek * level, 0.06);
  tone(k, t, 'triangle', 1050, 820, 0.03, LOUD.tek * 0.25 * level, 0.002, 0.035);
}

/** Frame drum: deeper and softer than a doum, with a longer tail. */
export function frameDrum(k: Kit, t: number, level = 1): void {
  tone(k, t, 'sine', 120, 58, 0.3, LOUD.frame * level, 0.008, 0.5);
  noise(k, t, 'lowpass', 380, 0.6, LOUD.frame * 0.3 * level, 0.08);
}

/** A soft breeze through the garden, `dur` seconds, for the percussion layer's bed. */
export function breeze(k: Kit, t: number, dur: number, level = 1): void {
  const c = k.ctx;
  const src = c.createBufferSource();
  src.buffer = k.noise;
  src.loop = true;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 0.6;
  f.frequency.setValueAtTime(500, t);
  // Slow gusts: the filter and the level drift up and down.
  for (let s = 0; s < dur; s += 2) {
    f.frequency.linearRampToValueAtTime(s % 4 === 0 ? 900 : 450, t + s + 2);
  }
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(LOUD.breeze * level, t + 1.5);
  g.gain.setValueAtTime(LOUD.breeze * level, t + dur - 1.5);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(k.out);
  src.start(t);
  src.stop(t + dur + 0.05);
}

/** A far-off bird in the garden: one or two quiet chirps. */
export function distantBird(k: Kit, t: number, r: number): void {
  const f = 2600 + r * 1400;
  chirp(k, t, f, f * 1.25, f * 1.05, 0.07, 0.35);
  if (r > 0.5) chirp(k, t + 0.11, f * 1.05, f * 1.35, f * 1.1, 0.08, 0.3);
}

// ---------- effects ----------

/**
 * The flap. 'classic' is the first version's soft rising blip, exactly as the live game plays it
 * (src/scene/audio.ts): a triangle gliding 420 → 720 Hz in 80 ms, with no pitch variation.
 * Amr chose it on 28 Nov 2026 over every newer flap.
 */
export function flap(k: Kit, t: number, voice: FlapVoice = 'classic'): void {
  if (voice === 'classic') tone(k, t, 'triangle', 420, 720, 0.08, LOUD.flap, 0.004, 0.12);
}

/** The score chime: a bright bell-like tone with its octave. `step` from chimeStep(). */
export function chime(k: Kit, t: number, step = 1, level = 1): void {
  const f = CHIME_HZ * step;
  tone(k, t, 'sine', f, f, 0, LOUD.chime * level, 0.005, 0.4);
  tone(k, t, 'sine', f * 2, f * 2, 0, LOUD.chime * 0.28 * level, 0.005, 0.25);
  tone(k, t, 'sine', f * 3.01, f * 3.01, 0, LOUD.chime * 0.06 * level, 0.003, 0.12);
}

/** Three tiny high glints, the sparkle on top of a bigger reward. Pure tones: no hiss. */
function glints(k: Kit, t: number, rate = 1): void {
  tone(k, t, 'sine', 3900 * rate, 3800 * rate, 0.05, LOUD.glint, 0.004, 0.09);
  tone(k, t + 0.04, 'sine', 4700 * rate, 4600 * rate, 0.05, LOUD.glint * 0.8, 0.004, 0.11);
  tone(k, t + 0.075, 'sine', 5600 * rate, 5500 * rate, 0.05, LOUD.glint * 0.6, 0.004, 0.13);
}

// Points: `step` is the chime's place on the scale; `rate` the ±3% variation of the rest.

/** +1 point: the chime. */
export function point(k: Kit, t: number, step = 1): void {
  chime(k, t, step);
}

/** +2: the chime with a glint. */
export function point2(k: Kit, t: number, step = 1, rate = 1): void {
  chime(k, t, step);
  glints(k, t + 0.04, rate);
}

/** +3: the chime, then Joud's happy "twee-tweet". */
export function point3(k: Kit, t: number, step = 1, rate = 1): void {
  chime(k, t, step, 0.8);
  chirp(k, t + 0.06, 3000 * rate, 4300 * rate, 3500 * rate, 0.07);
  chirp(k, t + 0.15, 3300 * rate, 4700 * rate, 3900 * rate, 0.09);
}

/** +5: the chime, then a joyful trill and a glint. */
export function point5(k: Kit, t: number, step = 1, rate = 1): void {
  chime(k, t, step, 0.8);
  for (let i = 0; i < 7; i++) {
    const f = (3100 + i * 90) * rate;
    chirp(k, t + 0.06 + i * 0.034, f, f * 1.3, f * 1.1, 0.04, 0.7 + i * 0.05, 0.03);
  }
  glints(k, t + 0.32, rate);
}

/** Flower: a bud opening (a soft rising pop), then a glint. */
export function bloom(k: Kit, t: number, rate = 1): void {
  tone(k, t, 'sine', 520 * rate, 1250 * rate, 0.05, LOUD.chime * 1.6, 0.004, 0.12);
  glints(k, t + 0.05, rate);
}

/** Crash: a soft thump, a startled little "aw" from Joud, and ruffled feathers. Never harsh. */
export function hit(k: Kit, t: number): void {
  tone(k, t, 'sine', 170, 60, 0.25, LOUD.thump, 0.006, 0.32);
  noise(k, t, 'lowpass', 700, 0.7, LOUD.thump * 0.3, 0.18);
  chirp(k, t + 0.04, 2900, 3100, 1500, 0.2, 0.9, 0.1);
  for (let i = 0; i < 3; i++) noise(k, t + 0.08 + i * 0.05, 'lowpass', 900, 0.8, LOUD.ruffle * (1 - i * 0.25), 0.04, 1300, 0.006);
}

/** New best: Joud sings a run of chirps and a trill, a sparkle, and a doum to finish. Starts 0.35 s late, after the crash. */
export function best(k: Kit, t: number): void {
  const s = t + 0.35;
  // Irregular pitches, like a real bird: a call, not a tune.
  const calls = [2900, 3250, 3050, 3400, 3150];
  for (let i = 0; i < calls.length; i++) {
    const f = calls[i];
    chirp(k, s + i * 0.09, f, f * 1.3, f * 1.12, 0.07, 0.8 + i * 0.05);
  }
  for (let i = 0; i < 8; i++) {
    const f = 3900 + i * 60;
    chirp(k, s + 0.47 + i * 0.03, f, f * 1.25, f * 1.08, 0.035, 0.6, 0.03);
  }
  chime(k, s + 0.47, 1, 0.9);
  glints(k, s + 0.5);
  doum(k, s + 0.47, 0.8);
}

/** Quiet UI tick for buttons. */
export function tick(k: Kit, t: number): void {
  const o = k.ctx.createOscillator();
  o.type = 'square';
  o.frequency.setValueAtTime(1300, t);
  const lp = k.ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2400;
  o.connect(lp).connect(env(k, t, LOUD.tick, 0.003, 0.042));
  o.start(t);
  o.stop(t + 0.06);
}
