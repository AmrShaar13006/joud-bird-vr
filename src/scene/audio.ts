// Original sound effects, synthesised in code with Web Audio (no samples,
// no music). Shared by both shells. Nothing plays until unlock() is called
// from a user gesture (click, key, trigger, Enter VR).

/** Pentatonic steps in semitones: the score chime climbs these with the streak. */
const CHIME_STEPS = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
const MASTER = 0.6;

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  constructor(public muted: boolean) {}

  /** Create or resume the audio context. Call only from a user gesture. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const AC =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : MASTER;
        this.master.connect(this.ctx.destination);
        // 0.3 s of white noise, made once, for the hit
        const len = Math.floor(this.ctx.sampleRate * 0.3);
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      // no audio on this device: the game works without it
    }
  }

  get unlocked(): boolean {
    return this.ctx?.state === 'running';
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : MASTER, this.ctx.currentTime, 0.02);
    }
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** Short soft rising blip. */
  flap(): void {
    const c = this.live();
    if (!c) return;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(420, t);
    o.frequency.exponentialRampToValueAtTime(720, t + 0.08);
    this.envelope(o, t, 0.2, 0.004, 0.12);
  }

  /** Chime; `streak` = points so far this round, so it climbs as the run goes on. */
  score(streak: number): void {
    const c = this.live();
    if (!c) return;
    const t = c.currentTime;
    const step = CHIME_STEPS[Math.max(0, streak - 1) % CHIME_STEPS.length];
    const f = 660 * Math.pow(2, step / 12);
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f, t);
    this.envelope(o, t, 0.18, 0.005, 0.4);
    const o2 = c.createOscillator();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(f * 2, t);
    this.envelope(o2, t, 0.05, 0.005, 0.25);
  }

  /** Soft low thump with a little filtered noise. Never harsh. */
  hit(): void {
    const c = this.live();
    if (!c) return;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.25);
    this.envelope(o, t, 0.32, 0.006, 0.32);
    if (this.noise && this.master) {
      const src = c.createBufferSource();
      src.buffer = this.noise;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 700;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.1, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      src.connect(lp).connect(g).connect(this.master);
      src.start(t);
      src.stop(t + 0.2);
    }
  }

  /** Quiet UI tick for buttons. */
  click(): void {
    const c = this.live();
    if (!c) return;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(1300, t);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    if (!this.master) return;
    o.connect(lp).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.06);
  }

  private live(): AudioContext | null {
    const c = this.ctx;
    return c && c.state === 'running' && !this.muted ? c : null;
  }

  /** Attack/decay envelope into the master bus, then stop. */
  private envelope(o: OscillatorNode, t: number, peak: number, attack: number, decay: number): void {
    if (!this.ctx || !this.master) return;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + attack + decay + 0.02);
  }
}
