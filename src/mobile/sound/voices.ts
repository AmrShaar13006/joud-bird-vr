// Every sound of the phone game, synthesised with Web Audio: no files, no melody (Joud's rule:
// percussion and effects only). Each voice draws into a Kit, so the same code plays live in
// the game and renders offline to .wav (scripts/sound/render-samples.mjs).

/** Where a voice plays: a (live or offline) context, its bus and a shared noise buffer. */
export interface Kit {
  ctx: BaseAudioContext;
  out: AudioNode;
  noise: AudioBuffer;
}

/**
 * Gain of each voice, tuned with `npm run sound:samples` so the effects land near the same
 * loudness (loudest 50 ms about -15 dBFS in the game). The flap sits about 7 dB lower (it
 * plays on every tap) and the button tick lower still. Change loudness here only.
 */
export const LOUD = {
  flapWhoosh: 1.45,
  flapBlip: 0.29,
  pop: 0.62,
  sparkle: 0.45,
  tek: 0.27,
  doum: 0.4,
  thump: 0.38,
  tick: 0.11,
  frame: 0.32,
} as const;

/** Flap voices: a setting, so flap-sound items can add more later. */
export const FLAP_VOICES = ['whoosh', 'blip'] as const;
export type FlapVoice = (typeof FLAP_VOICES)[number];

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
  o.frequency.exponentialRampToValueAtTime(f1, t + glide);
  o.connect(env(k, t, peak, attack, decay));
  o.start(t);
  o.stop(t + attack + decay + 0.02);
}

/** Filtered noise burst. `sweep` glides the filter to that frequency. */
function noise(k: Kit, t: number, type: BiquadFilterType, freq: number, q: number, peak: number, decay: number, sweep = freq): void {
  const src = k.ctx.createBufferSource();
  src.buffer = k.noise;
  const f = k.ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (sweep !== freq) f.frequency.exponentialRampToValueAtTime(sweep, t + decay);
  src.connect(f).connect(env(k, t, peak, 0.003, decay));
  src.start(t);
  src.stop(t + decay + 0.03);
}

// ---------- drums ----------

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

// ---------- effects ----------

/** `rate`: pitch factor for the ±3% variation (1 = none). */
export function flap(k: Kit, t: number, voice: FlapVoice, rate = 1): void {
  if (voice === 'blip') {
    tone(k, t, 'triangle', 420 * rate, 720 * rate, 0.08, LOUD.flapBlip, 0.004, 0.12);
    return;
  }
  noise(k, t, 'bandpass', 700 * rate, 1.1, LOUD.flapWhoosh, 0.11, 1600 * rate);
  tone(k, t, 'triangle', 300 * rate, 460 * rate, 0.07, LOUD.flapWhoosh * 0.1, 0.006, 0.08);
}

/** One short bright pop for a +1 or +2 point. */
export function pop(k: Kit, t: number, rate = 1): void {
  tone(k, t, 'sine', 1500 * rate, 760 * rate, 0.045, LOUD.pop, 0.002, 0.09);
  tone(k, t, 'triangle', 3000 * rate, 1500 * rate, 0.03, LOUD.pop * 0.18, 0.002, 0.05);
}

/** Light sparkle: a shimmer of high noise with two very short glints (not a tune). */
export function sparkle(k: Kit, t: number, rate = 1): void {
  noise(k, t, 'highpass', 6000, 0.7, LOUD.sparkle * 0.6, 0.22);
  tone(k, t, 'sine', 3900 * rate, 3700 * rate, 0.05, LOUD.sparkle, 0.002, 0.08);
  tone(k, t + 0.045, 'sine', 4700 * rate, 4500 * rate, 0.05, LOUD.sparkle * 0.8, 0.002, 0.1);
}

/** +3: tek-tek-doum. */
export function roll3(k: Kit, t: number): void {
  tek(k, t, 0.8);
  tek(k, t + 0.075);
  doum(k, t + 0.15);
}

/** +5: tek-tek-tek-tek-doum. */
export function roll5(k: Kit, t: number): void {
  for (let i = 0; i < 4; i++) tek(k, t + i * 0.065, 0.65 + i * 0.12);
  doum(k, t + 0.28);
}

/** Crash: a soft thump with a short tek roll. Never harsh. */
export function hit(k: Kit, t: number): void {
  tone(k, t, 'sine', 170, 55, 0.26, LOUD.thump, 0.006, 0.34);
  noise(k, t, 'lowpass', 700, 0.7, LOUD.thump * 0.3, 0.18);
  for (let i = 0; i < 3; i++) tek(k, t + 0.09 + i * 0.06, 0.5 - i * 0.12);
}

/** New best: a drum flourish ending on a doum, plus a sparkle. Starts 0.35 s late, after the crash. */
export function best(k: Kit, t: number): void {
  const s = t + 0.35;
  const at = [0, 0.08, 0.15, 0.21, 0.26, 0.3];
  for (let i = 0; i < at.length; i++) tek(k, s + at[i], 0.55 + i * 0.08);
  doum(k, s + 0.38, 1.1);
  sparkle(k, s + 0.38);
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
