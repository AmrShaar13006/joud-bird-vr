import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../core/game';
import { BUZZ, type FramePlan, jitter, planFrame, scoreCue } from './director';
import { BAR, BPM, layerFor, MAQSUM, PULSE } from './percussion';
import { CHIME_STEPS, chimeStep, flap, type Kit, LOUD } from './voices';
import { KEYS, type KeyStore, loadSoundSettings, saveSoundSetting } from './settings';

const plan = (events: GameEvent[], delta = 0): FramePlan => planFrame(events, delta, { cues: [], buzz: null });

function memStore(init: Record<string, string> = {}): KeyStore & { data: Record<string, string> } {
  const data = { ...init };
  return { data, get: (k) => data[k] ?? null, set: (k, v) => void (data[k] = v) };
}

describe('sound director', () => {
  it('maps points to the chime and its bigger versions', () => {
    expect([1, 2, 3, 5].map(scoreCue)).toEqual(['point', 'point2', 'point3', 'point5']);
  });

  it('never vibrates on flap; vibrates on +5, hit and new best only', () => {
    expect(plan(['flap'])).toEqual({ cues: ['flap'], buzz: null });
    expect(plan(['score'], 3).buzz).toBeNull();
    expect(plan(['flower']).buzz).toBeNull();
    expect(plan(['score'], 5).buzz).toBe(BUZZ.plus5);
    expect(plan(['hit']).buzz).toBe(BUZZ.hit);
    expect(plan(['hit', 'newBest', 'state'])).toEqual({ cues: ['hit', 'best'], buzz: BUZZ.best });
  });

  it('plays one score cue and one flap per frame, plus the bloom', () => {
    expect(plan(['flap', 'flap', 'score', 'score', 'flower'], 3).cues).toEqual(['flap', 'point3', 'bloom']);
  });

  it('ignores events with no sound', () => {
    expect(plan(['bounce', 'state', 'mode']).cues).toEqual([]);
  });

  it('reuses the plan object', () => {
    const out: FramePlan = { cues: [], buzz: null };
    const cues = out.cues;
    planFrame(['hit'], 0, out);
    planFrame(['flap'], 0, out);
    expect(out.cues).toBe(cues);
    expect(out).toEqual({ cues: ['flap'], buzz: null });
  });

  it('varies pitch by at most 3%', () => {
    expect(jitter(0)).toBeCloseTo(0.97);
    expect(jitter(0.999999)).toBeCloseTo(1.03);
  });
});

describe('sound switches', () => {
  it('default both on', () => {
    expect(loadSoundSettings(memStore(), false)).toEqual({ effects: true, percussion: true });
  });

  it('an old muted = 1 turns both off', () => {
    expect(loadSoundSettings(memStore({ [KEYS.legacyMuted]: '1' }), false)).toEqual({ effects: false, percussion: false });
  });

  it('saved switches win over the old mute', () => {
    const s = memStore({ [KEYS.legacyMuted]: '1' });
    saveSoundSetting(s, 'effects', true);
    expect(loadSoundSettings(s, false)).toEqual({ effects: true, percussion: false });
  });

  it('?mute=1 starts both off without saving', () => {
    const s = memStore({ [KEYS.effects]: '1', [KEYS.percussion]: '1' });
    expect(loadSoundSettings(s, true)).toEqual({ effects: false, percussion: false });
    expect(s.data).toEqual({ [KEYS.effects]: '1', [KEYS.percussion]: '1' });
  });
});

describe('percussion layer', () => {
  it('silence below 10, frame drum from 10, full rhythm from 25', () => {
    expect([0, 9, 10, 24, 25, 80].map(layerFor)).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it('is drums only: one bar of eighths at one tempo, and the preview lasts 20 s', () => {
    expect(BPM).toBe(96);
    expect(MAQSUM).toMatch(/^[DT.]{8}$/);
    expect(PULSE).toMatch(/^[F.]{8}$/);
    expect(BAR * 8).toBeCloseTo(20);
  });
});

describe('score chime', () => {
  it('climbs the old pentatonic steps with the run, then starts again', () => {
    expect(chimeStep(1)).toBe(1);
    expect(chimeStep(4)).toBeCloseTo(Math.pow(2, 7 / 12));
    expect(chimeStep(11)).toBeCloseTo(4);
    expect(chimeStep(12)).toBe(1);
    expect(chimeStep(0)).toBe(1);
    expect(CHIME_STEPS).toEqual([0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24]);
  });
});

describe('flap', () => {
  // Records what a voice asks of Web Audio, so the flap can be compared with the live game's.
  function recorder(): { kit: Kit; oscs: { type: string; freq: unknown[]; stop: number }[]; gains: unknown[][] } {
    const oscs: { type: string; freq: unknown[]; stop: number }[] = [];
    const gains: unknown[][] = [];
    const param = (log: unknown[]) => ({
      setValueAtTime: (v: number, t: number) => log.push(['set', v, t]),
      exponentialRampToValueAtTime: (v: number, t: number) => log.push(['exp', v, t]),
    });
    const ctx = {
      createOscillator: () => {
        const o = { type: 'sine', freq: [] as unknown[], stop: -1 };
        oscs.push(o);
        return { set type(v: string) { o.type = v; }, frequency: param(o.freq), connect: (n: unknown) => n, start: () => {}, stop: (t: number) => (o.stop = t) };
      },
      createGain: () => {
        const log: unknown[] = [];
        gains.push(log);
        return { gain: param(log), connect: (n: unknown) => n };
      },
    };
    return { kit: { ctx, out: {}, noise: {} } as unknown as Kit, oscs, gains };
  }

  it("is the live game's flap: a triangle 420 → 720 Hz in 80 ms, 4 ms attack, 120 ms decay, no pitch variation", () => {
    const r = recorder();
    flap(r.kit, 0);
    flap(r.kit, 0);
    expect(r.oscs).toHaveLength(2);
    for (const [i, o] of r.oscs.entries()) {
      expect(o.type).toBe('triangle');
      expect(o.freq).toEqual([['set', 420, 0], ['exp', 720, 0.08]]);
      expect(o.stop).toBeCloseTo(0.144);
      expect(r.gains[i]).toEqual([['set', 0.0001, 0], ['exp', LOUD.flap, 0.004], ['exp', 0.0001, 0.124]]);
    }
  });
});
