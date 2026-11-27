// The phone game's sound engine (play/ only; the VR pages keep src/scene/audio.ts).
// Web Audio, synthesised, no files. Nothing plays until unlock() runs from a user gesture.
// Buses: effects and percussion → master gain → limiter → speakers.

import type { GameEvent } from '../../core/game';
import { type Cue, type FramePlan, jitter, planFrame } from './director';
import { vibrate } from './haptics';
import type { SoundSettings } from './settings';
import * as V from './voices';

export const MASTER_GAIN = 0.8;
/** At most this many effects at once; extra flaps and chimes are dropped, never crashes. */
const MAX_VOICES = 10;
const VOICE_LIFE = 0.45;

/** Master limiter: overlapping sounds never clip on phone speakers. */
export function makeLimiter(ctx: BaseAudioContext): DynamicsCompressorNode {
  const l = ctx.createDynamicsCompressor();
  l.threshold.value = -6;
  l.knee.value = 0;
  l.ratio.value = 20;
  l.attack.value = 0.001;
  l.release.value = 0.12;
  return l;
}

/**
 * Play one cue into a kit. Shared by the engine and the offline renders. `run`: points so far
 * this round (the chime climbs with it); `rate`: the ±3% pitch variation.
 */
export function playCue(k: V.Kit, cue: Cue, t: number, flapVoice: V.FlapVoice, rate: number, run = 1): void {
  switch (cue) {
    case 'flap':
      return V.flap(k, t, flapVoice, rate);
    case 'point':
      return V.point(k, t, V.chimeStep(run));
    case 'point2':
      return V.point2(k, t, V.chimeStep(run), rate);
    case 'point3':
      return V.point3(k, t, V.chimeStep(run), rate);
    case 'point5':
      return V.point5(k, t, V.chimeStep(run), rate);
    case 'bloom':
      return V.bloom(k, t, rate);
    case 'hit':
      return V.hit(k, t);
    case 'best':
      return V.best(k, t);
  }
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private effectsBus: GainNode | null = null;
  private percussionBus: GainNode | null = null;
  private kit: V.Kit | null = null;
  private readonly plan: FramePlan = { cues: [], buzz: null };
  private voiceEnds: number[] = [];
  flapVoice: V.FlapVoice = 'wings';

  constructor(readonly settings: SoundSettings) {}

  /** Create or resume the context. Call from a user gesture (also after an iPhone interruption). */
  unlock(): void {
    try {
      if (!this.ctx) {
        // Respect the iPhone silent switch and mix with the player's own audio.
        const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
        if (session) session.type = 'ambient';
        const AC =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        const ctx = new AC({ latencyHint: 'interactive' });
        this.ctx = ctx;
        this.master = ctx.createGain();
        this.master.gain.value = MASTER_GAIN;
        this.master.connect(makeLimiter(ctx)).connect(ctx.destination);
        this.effectsBus = this.bus(this.settings.effects);
        this.percussionBus = this.bus(this.settings.percussion);
        this.kit = { ctx, out: this.effectsBus, noise: V.makeNoise(ctx) };
      }
      // 'suspended' after page hide, 'interrupted' after a call or Siri on iPhone.
      if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => {});
    } catch {
      // no audio on this device: the game works without it
    }
  }

  get unlocked(): boolean {
    return this.ctx?.state === 'running';
  }

  /** Page hidden or closed: stop the audio clock to save battery. */
  suspend(): void {
    if (this.ctx?.state === 'running') void this.ctx.suspend().catch(() => {});
  }

  /** Page visible again (iPhone may still want a tap: unlock() handles that). */
  resume(): void {
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => {});
  }

  set(which: keyof SoundSettings, on: boolean): void {
    this.settings[which] = on;
    const bus = which === 'effects' ? this.effectsBus : this.percussionBus;
    if (this.ctx && bus) bus.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.02);
  }

  /** The percussion bus and kit, for the percussion layer (PR 2) and the debug sampler. */
  percussionKit(): V.Kit | null {
    return this.ctx && this.kit && this.percussionBus ? { ...this.kit, out: this.percussionBus } : null;
  }

  /**
   * Sounds and vibration for one frame's game events. `pointsDelta`: obstacle points gained
   * this frame; `run`: obstacles passed this round (the chime climbs with it).
   */
  frame(events: readonly GameEvent[], pointsDelta: number, run: number): void {
    if (events.length === 0) return;
    const p = planFrame(events, pointsDelta, this.plan);
    for (const cue of p.cues) this.play(cue, run);
    if (p.buzz && this.settings.effects) vibrate(p.buzz);
  }

  play(cue: Cue, run = 1): void {
    const k = this.live();
    if (!k) return;
    const t = k.ctx.currentTime;
    if (cue === 'flap' || cue === 'point') {
      // Drop finished voices, then skip this one if the effects are crowded.
      let n = 0;
      for (const e of this.voiceEnds) if (e > t) this.voiceEnds[n++] = e;
      this.voiceEnds.length = n;
      if (this.voiceEnds.length >= MAX_VOICES) return;
      this.voiceEnds.push(t + VOICE_LIFE);
    }
    playCue(k, cue, t, this.flapVoice, jitter(Math.random()), run);
  }

  /** Quiet tick for buttons. */
  tick(): void {
    const k = this.live();
    if (k) V.tick(k, k.ctx.currentTime);
  }

  private bus(on: boolean): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = on ? 1 : 0;
    g.connect(this.master!);
    return g;
  }

  private live(): V.Kit | null {
    return this.kit && this.ctx?.state === 'running' && this.settings.effects ? this.kit : null;
  }
}
