// Which sounds and vibration a frame's game events call for. Pure (no Web Audio), so it is
// tested in Node. Reads core events only; the core never knows sound exists.

import type { GameEvent } from '../../core/game';

export type Cue = 'flap' | 'point' | 'point2' | 'point3' | 'point5' | 'bloom' | 'hit' | 'best';

/** Android vibration patterns (ms on, off, on…). Never on flap. */
export const BUZZ = {
  plus5: [30],
  hit: [40, 30, 60],
  best: [25, 60, 25, 60, 25],
} as const;

export interface FramePlan {
  cues: Cue[];
  buzz: readonly number[] | null;
}

/** +1 the chime, +2 with a glint, +3 with Joud's tweet, +5 (or more) with a trill. */
export function scoreCue(points: number): Cue {
  return points >= 5 ? 'point5' : points >= 3 ? 'point3' : points >= 2 ? 'point2' : 'point';
}

/**
 * Fill `out` (reused, so nothing is allocated per frame) from one frame's events.
 * `pointsDelta`: obstacle points gained this frame. One score cue per frame at most.
 */
export function planFrame(events: readonly GameEvent[], pointsDelta: number, out: FramePlan): FramePlan {
  out.cues.length = 0;
  out.buzz = null;
  let scored = false;
  for (const e of events) {
    switch (e) {
      case 'flap':
        if (!out.cues.includes('flap')) out.cues.push('flap');
        break;
      case 'score':
        if (scored) break;
        scored = true;
        out.cues.push(scoreCue(pointsDelta));
        if (pointsDelta >= 5 && !out.buzz) out.buzz = BUZZ.plus5;
        break;
      case 'flower':
        out.cues.push('bloom');
        break;
      case 'hit':
        out.cues.push('hit');
        if (out.buzz !== BUZZ.best) out.buzz = BUZZ.hit;
        break;
      case 'newBest':
        out.cues.push('best');
        out.buzz = BUZZ.best;
        break;
    }
  }
  return out;
}

/** Quick taps (under 0.35 s apart) lift the flap's pitch 2% each, up to 8%; a pause resets it. */
export function flapLift(lift: number, sinceLast: number): number {
  return sinceLast >= 0 && sinceLast < 0.35 ? Math.min(lift + 0.02, 0.08) : 0;
}

/** A pitch factor within ±3%; `r` is a random number in [0, 1). */
export function jitter(r: number): number {
  return 0.97 + r * 0.06;
}
