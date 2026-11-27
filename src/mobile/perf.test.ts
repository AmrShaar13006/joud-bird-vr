import { describe, expect, it } from 'vitest';
import { chooseTier, FrameWatchdog, lowerTier, parseTier, TIER_SETTINGS } from './perf';

const phone = (over: Partial<Parameters<typeof chooseTier>[0]> = {}) => ({
  cores: 8,
  memoryGb: 8,
  screenW: 390,
  screenH: 844,
  dpr: 3,
  ...over,
});

describe('render tiers', () => {
  it('chooses from cores, memory, screen size and DPR', () => {
    expect(chooseTier(phone())).toBe('high');
    expect(chooseTier(phone({ cores: 2 }))).toBe('low');
    expect(chooseTier(phone({ memoryGb: 2 }))).toBe('low');
    expect(chooseTier(phone({ cores: 4, memoryGb: 4, dpr: 2 }))).toBe('medium');
    expect(chooseTier(phone({ cores: 4, memoryGb: 4, dpr: 3 }))).toBe('low');
    expect(chooseTier(phone({ cores: 6, screenW: 430, screenH: 932, dpr: 3 }))).toBe('medium');
    // Safari: no deviceMemory → not held against the device.
    expect(chooseTier(phone({ memoryGb: 0 }))).toBe('high');
  });

  it('settings: pixel-ratio cap 1 / 1.5 / 2 and less work on low', () => {
    expect(TIER_SETTINGS.low.pixelRatio).toBe(1);
    expect(TIER_SETTINGS.medium.pixelRatio).toBe(1.5);
    expect(TIER_SETTINGS.high.pixelRatio).toBe(2);
    expect(TIER_SETTINGS.low).toMatchObject({ antialias: false, effects: false, scenery: false, birdGlb: false });
  });

  it('parses ?tier= and steps down only', () => {
    expect(parseTier('low')).toBe('low');
    expect(parseTier('ultra')).toBeNull();
    expect(parseTier(null)).toBeNull();
    expect(lowerTier('high')).toBe('medium');
    expect(lowerTier('medium')).toBe('low');
    expect(lowerTier('low')).toBe('low');
  });
});

describe('frame watchdog', () => {
  const run = (w: FrameWatchdog, ms: number, seconds: number) => {
    let drops = 0;
    for (let t = 0; t < seconds; t += ms / 1000) if (w.frame(ms / 1000)) drops++;
    return drops;
  };

  it('drops after 3 s averaging over 20 ms, not before', () => {
    const w = new FrameWatchdog();
    expect(run(w, 25, 2.4)).toBe(0);
    expect(run(w, 25, 1)).toBe(1);
  });

  it('a fast stretch resets the clock; 60 fps never drops', () => {
    const w = new FrameWatchdog();
    expect(run(w, 25, 2.4)).toBe(0);
    expect(run(w, 16, 1)).toBe(0);
    expect(run(w, 25, 2.4)).toBe(0);
    expect(run(new FrameWatchdog(), 16.7, 60)).toBe(0);
  });

  it('ignores tab-switch hitches', () => {
    const w = new FrameWatchdog();
    for (let i = 0; i < 20; i++) expect(w.frame(2)).toBe(false);
  });
});
