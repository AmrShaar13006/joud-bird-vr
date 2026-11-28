// Joud v2's five clips (public/models/joud-v2.glb) and how they follow each other (Amr,
// 27-28 Nov 2026). Shared by the model viewer's tap demo (model-view.ts) and the game's
// ?model=v2 bird (joud-v2-bird.ts), so the two play them the same way.
//
// Only lazily loaded modules import this one (the viewer and the v2 bird), never the play/
// entry: the viewer cannot import anything from the entry's chunk (see model-gate.ts).
//
//   flap         on every tap, cross-fade 0.08 s; a tap during flap restarts it with a 0.05 s
//                cross-fade; taps under 0.3 s apart play it at up to 1.6x speed
//   flap ends    glide (flap's last frame is glide's first)
//   dropping     fall, once the bird sinks faster than 65 % of its terminal speed
//   contact      crash, cross-fade 0.05 s
//   ready        idle
//
// Weights are set by hand so they always add up to 1: a channel that a clip leaves at rest then
// blends towards the bind pose by exactly the other clips' share, and a cross-fade that is
// interrupted by the next one carries on from the pose on screen without a jump.

import { type AnimationAction, type AnimationClip, AnimationMixer, LoopOnce, LoopRepeat, type Object3D } from 'three';

export const CLIPS = ['idle', 'flap', 'glide', 'fall', 'crash'] as const;
export type Clip = (typeof CLIPS)[number];
export const isClip = (name: string): name is Clip => (CLIPS as readonly string[]).includes(name);

export const FADE = 0.08; // seconds: every cross-fade ...
export const FADE_QUICK = 0.05; // ... but a tap during flap, and the crash on contact
const FAST_TAP = 0.3; // taps closer than this speed the flap up ...
const FAST_TAP_FULL = 0.15; // ... reaching FLAP_MAX_SPEED at this gap
const FLAP_MAX_SPEED = 1.6;
/** Sinking faster than this share of the terminal speed (cfg.maxFall) is a fall, not a glide. */
export const FALL_SHARE = 0.65;
export const DEFAULT_LOOP: Record<Clip, boolean> = { idle: true, flap: false, glide: true, fall: true, crash: false };

// How the game shows and moves the bird: the root as src/scene/bird.ts moves it, and the two
// view settings Amr chose for v2 (28 Nov 2026).
/** Degrees of root tilt at vy = ±flapVelocity (bird.ts). */
export const TILT_MAX = 30;
/** The root's squash on a flap (bird.ts). */
export const SQUASH = { wide: 0.1, flat: 0.18, fade: 8 };
/** Degrees the bird leans towards the level game camera, on a wrapper above the root. */
export const PRESENT_TILT = 14;
/** Degrees v2 turns about Y in the game (v1, bird.ts: -55). */
export const V2_TURN = -45;

/** Flap playback speed for a tap that comes `gap` seconds after the one before. */
export function flapSpeed(gap: number): number {
  if (!(gap < FAST_TAP)) return 1;
  return 1 + (FLAP_MAX_SPEED - 1) * Math.min(1, (FAST_TAP - gap) / (FAST_TAP - FAST_TAP_FULL));
}

/**
 * A mixer for a model's root, for the game's v2 bird. The viewer makes its own where it always
 * has. Both keep the order in which the build first meets AnimationMixer, so the three.js chunk
 * shared with the VR pages keeps its export names and those pages build to the same files.
 */
export function createMixer(root: Object3D): AnimationMixer {
  return new AnimationMixer(root);
}

/** The clips of one model on one mixer, with hand-weighted cross-fades. */
export class JoudClips {
  readonly mixer: AnimationMixer;
  readonly actions = new Map<Clip, AnimationAction>();
  readonly loops = new Map<Clip, boolean>();
  /** All five clips are there. */
  readonly complete: boolean;
  /** The clip fading in or playing, and its action. */
  lead: { clip: Clip; action: AnimationAction } | null = null;
  private readonly flapPool: AnimationAction[] = []; // a restarted flap fades in over the one still playing
  private readonly live = new Set<AnimationAction>(); // every action with some weight
  private fade: { rest: [AnimationAction, number][]; t: number; d: number } | null = null;
  private lastTap = Number.NEGATIVE_INFINITY;

  /**
   * `mixer`: a new AnimationMixer on the model's root (see createMixer). `loop`: the GLB's own
   * loop flag for a clip, if it has one.
   */
  constructor(mixer: AnimationMixer, clips: AnimationClip[], loop: (clip: Clip) => boolean | undefined = () => undefined) {
    this.mixer = mixer;
    for (const c of clips) {
      const name = c.name;
      if (!isClip(name)) continue;
      const loops = loop(name) ?? DEFAULT_LOOP[name];
      this.loops.set(name, loops);
      const make = (clip: AnimationClip): AnimationAction => {
        const a = this.mixer.clipAction(clip);
        a.setLoop(loops ? LoopRepeat : LoopOnce, loops ? Infinity : 1);
        a.clampWhenFinished = true;
        return a;
      };
      this.actions.set(name, make(c));
      if (name === 'flap') this.flapPool.push(this.actions.get(name)!, make(c.clone()), make(c.clone()));
    }
    this.complete = CLIPS.every((c) => this.actions.has(c));
  }

  /** Fade `clip` in over `seconds` (0: at once), at `speed`. */
  fadeTo(clip: Clip, seconds: number, speed = 1): void {
    let next = this.actions.get(clip);
    if (!next) return;
    if (clip === 'flap') {
      next = this.flapPool.find((a) => !this.live.has(a)) ?? this.flapPool.reduce((a, b) => (a.getEffectiveWeight() <= b.getEffectiveWeight() ? a : b));
    }
    const rest: [AnimationAction, number][] = [];
    for (const a of this.live) if (a !== next) rest.push([a, a.getEffectiveWeight()]);
    next.reset();
    next.setEffectiveTimeScale(speed);
    next.play();
    this.live.add(next);
    if (seconds > 0 && rest.length > 0) {
      next.setEffectiveWeight(0);
      this.fade = { rest, t: 0, d: seconds };
    } else {
      for (const [a] of rest) {
        a.stop();
        this.live.delete(a);
      }
      next.setEffectiveWeight(1);
      this.fade = null;
    }
    this.lead = { clip, action: next };
  }

  /** Move the cross-fade on by `dt` seconds (Infinity: finish it now). */
  stepFade(dt: number): void {
    const f = this.fade;
    if (!f || !this.lead) return;
    f.t += dt;
    const k = Math.min(1, f.t / f.d);
    this.lead.action.setEffectiveWeight(k);
    for (const [a, w] of f.rest) {
      if (k < 1) a.setEffectiveWeight(w * (1 - k));
      else {
        a.stop();
        this.live.delete(a);
      }
    }
    if (k >= 1) this.fade = null;
  }

  /** Cross-fades, then the mixer. */
  update(dt: number): void {
    this.stepFade(dt);
    this.mixer.update(dt);
  }

  /** The lead clip is a one-shot that has reached its last frame. */
  leadDone(): boolean {
    const l = this.lead;
    return !!l && !this.loops.get(l.clip) && l.action.time >= l.action.getClip().duration - 1e-4;
  }

  /** Nothing playing. */
  stop(): void {
    this.mixer.stopAllAction();
    this.live.clear();
    this.fade = null;
    this.lead = null;
    this.lastTap = Number.NEGATIVE_INFINITY;
  }

  // --- the game's rules (the tap demo and the game) --------------------------------------------------

  /** Ready for a round: idle. */
  ready(): void {
    this.lastTap = Number.NEGATIVE_INFINITY;
    this.fadeTo('idle', this.lead ? FADE : 0);
  }

  /**
   * A flap at `now` (seconds on any clock), the first of a round if `first`. Returns the gap to
   * the tap before (0 for the first) and the flap's speed.
   */
  tap(now: number, first: boolean): { gap: number; speed: number } {
    const gap = first ? 0 : now - this.lastTap;
    const speed = first ? 1 : flapSpeed(gap);
    this.lastTap = now;
    this.fadeTo('flap', this.lead?.clip === 'flap' ? FADE_QUICK : FADE, speed);
    return { gap, speed };
  }

  /** Contact: crash, once. */
  crash(): void {
    if (this.lead?.clip !== 'crash') this.fadeTo('crash', FADE_QUICK);
  }

  /** In flight, once per frame: glide when a flap ends, fall when sinking faster than `fallVy`. */
  follow(vy: number, fallVy: number): void {
    const l = this.lead;
    if (!l) return;
    if (l.clip === 'flap' && this.leadDone()) this.fadeTo('glide', FADE);
    else if (l.clip === 'glide' && vy < fallVy) this.fadeTo('fall', FADE);
  }
}
