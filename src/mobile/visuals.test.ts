import { describe, expect, it } from 'vitest';
import { MOBILE1 } from '../core/ruleset';
import {
  buildFacade,
  buildPlazaRow,
  FAR_METRE,
  FAR_PARALLAX,
  FAR_TILE_M,
  layerOffset,
  NEAR_METRE,
  NEAR_PARALLAX,
  NEAR_TILE_M,
} from './backdrop';

import { KINDS } from '../core/ruleset';
import { ATLAS_COLS, ATLAS_ROWS, boxTile, tileRect, WORD_TILES, wordColumn } from './box-art';
import { BADGE_COLS, BADGE_ROWS, badgeKey, badgeLabel, badgeRect, cueFor, SPARKLE_TILE } from './cues';
import { laneFrame, parseBirdScale } from './view';

describe('obstacle cues', () => {
  const pts = MOBILE1.points;

  it('badges show exactly what the ruleset pays; plain gates get none', () => {
    expect(cueFor({ kind: 'gate' }, pts)).toBeNull();
    for (const kind of KINDS) {
      const c = cueFor({ kind }, pts);
      if (kind === 'gate') continue;
      expect(c).not.toBeNull();
      const expected = kind === 'fork' ? pts.forkRisky : pts[kind];
      expect(c!.value).toBe(expected);
      expect(badgeLabel(c!)).toBe(`+${expected}`);
      expect(c!.risky).toBe(kind === 'fork');
      expect(c!.moving).toBe(kind === 'moving');
    }
  });

  it('look-alike badges share a tile; the sparkle tile is the last', () => {
    const key = (k: (typeof KINDS)[number]) => badgeKey(cueFor({ kind: k }, pts)!);
    expect(key('stairs')).toBe(key('updraft')); // both +2
    expect(key('narrow')).not.toBe(key('moving')); // +3 vs +3 ↕
    expect(key('fork')).not.toBe(key('narrow'));
    const distinct = new Set(['stairs', 'updraft', 'narrow', 'moving', 'fork'].map((k) => key(k as never)));
    expect(distinct.size).toBeLessThan(SPARKLE_TILE + 1);
    expect(SPARKLE_TILE).toBe(BADGE_COLS * BADGE_ROWS - 1);
    for (let t = 0; t <= SPARKLE_TILE; t++) {
      const [u0, v0, uw, vh] = badgeRect(t);
      expect(u0).toBeGreaterThanOrEqual(0);
      expect(v0).toBeGreaterThanOrEqual(0);
      expect(u0 + uw).toBeLessThanOrEqual(1);
      expect(v0 + vh).toBeLessThanOrEqual(1);
    }
  });

  it('badges never cover the words: they go on the other column', () => {
    for (let slot = 0; slot < 6; slot++) {
      const words = wordColumn(slot);
      const k0 = boxTile(slot, 0, words === 'upper' ? 'lower' : 'upper');
      expect(new Set<number>(WORD_TILES).has(k0)).toBe(false);
    }
  });
});

const lane = MOBILE1.modes.normal;

describe('campaign box faces', () => {
  it('one column per obstacle reads أنا / ادّعم / جود top to bottom at the gap', () => {
    const [ana, adam, joud] = WORD_TILES;
    // Even slot: the upper column (k = 0 at the gap, counting upwards).
    expect([2, 1, 0].map((k) => boxTile(4, k, 'upper'))).toEqual([ana, adam, joud]);
    // Odd slot: the lower column (k = 0 at the gap, counting downwards).
    expect([0, 1, 2].map((k) => boxTile(3, k, 'lower'))).toEqual([ana, adam, joud]);
    // The other column, the fork's middle block and boxes further out are decorative.
    const words = new Set<number>(WORD_TILES);
    for (let k = 0; k < 20; k++) {
      expect(words.has(boxTile(4, k, 'lower'))).toBe(false);
      expect(words.has(boxTile(3, k, 'upper'))).toBe(false);
      expect(words.has(boxTile(5, k, 'middle'))).toBe(false);
      if (k >= 3) expect(words.has(boxTile(4, k, 'upper'))).toBe(false);
    }
  });

  it('every tile index is in the atlas and the pick is deterministic', () => {
    for (let slot = 0; slot < 8; slot++)
      for (let k = 0; k < 40; k++)
        for (const c of ['upper', 'lower', 'middle'] as const) {
          const t = boxTile(slot, k, c);
          expect(t).toBeGreaterThanOrEqual(0);
          expect(t).toBeLessThan(ATLAS_COLS * ATLAS_ROWS);
          expect(boxTile(slot, k, c)).toBe(t);
        }
  });

  it('tile rectangles stay inside their tile; a cut box crops instead of squashing', () => {
    for (let t = 0; t < ATLAS_COLS * ATLAS_ROWS; t++) {
      const [u0, v0, uw, vh] = tileRect(t, 1, false);
      const col = t % ATLAS_COLS;
      const row = Math.floor(t / ATLAS_COLS);
      expect(u0).toBeGreaterThan(col / ATLAS_COLS);
      expect(u0 + uw).toBeLessThan((col + 1) / ATLAS_COLS);
      expect(v0).toBeGreaterThan(1 - (row + 1) / ATLAS_ROWS);
      expect(v0 + vh).toBeLessThan(1 - row / ATLAS_ROWS);
      // Half a box keeps the bottom half or the top half of the same tile.
      const bottom = tileRect(t, 0.5, false);
      const top = tileRect(t, 0.5, true);
      expect(bottom[3]).toBeCloseTo(vh / 2, 9);
      expect(bottom[1]).toBeCloseTo(v0, 9);
      expect(top[1] + top[3]).toBeCloseTo(v0 + vh, 9);
    }
  });
});

describe('venue backdrop', () => {
  const layers = [
    { name: 'façade', geo: buildFacade(), metre: FAR_METRE, tileM: FAR_TILE_M, factor: FAR_PARALLAX, maxM: 13.4 },
    { name: 'plaza row', geo: buildPlazaRow(), metre: NEAR_METRE, tileM: NEAR_TILE_M, factor: NEAR_PARALLAX, maxM: 8.5 },
  ];

  for (const l of layers) {
    it(`${l.name}: covers the lane at every scroll offset and stays low`, () => {
      l.geo.computeBoundingBox();
      const box = l.geo.boundingBox!;
      const tile = l.tileM * l.metre;
      expect(tile).toBeGreaterThanOrEqual(lane.laneW);
      // Offsets range over [−tile/2, tile/2): the two copies must cover the lane either way.
      expect(box.min.x * l.metre + tile / 2).toBeLessThanOrEqual(-lane.laneW / 2);
      expect(box.max.x * l.metre - tile / 2).toBeGreaterThanOrEqual(lane.laneW / 2);
      expect(box.min.y).toBeGreaterThanOrEqual(0);
      expect(box.max.y).toBeLessThanOrEqual(l.maxM);
      // Well below the lane top, so the upper lane stays open sky.
      expect(box.max.y * l.metre).toBeLessThan(lane.laneH * 0.6);
      const tris = l.geo.getAttribute('position').count / 3;
      expect(tris).toBeGreaterThan(50);
      expect(tris).toBeLessThan(4000);
    });
  }

  it('parallax offset wraps every tile and stays centred', () => {
    const w = FAR_TILE_M * FAR_METRE;
    for (const s of [0, 0.37, 5, 123.4, 9999.9]) {
      const o = layerOffset(s, FAR_PARALLAX, w);
      expect(o).toBeGreaterThanOrEqual(-w / 2);
      expect(o).toBeLessThan(w / 2);
      expect(layerOffset(s + w / FAR_PARALLAX, FAR_PARALLAX, w)).toBeCloseTo(o, 6);
    }
    // Moves with the obstacles (+x) between wraps.
    expect(layerOffset(1, FAR_PARALLAX, w)).toBeGreaterThan(layerOffset(0, FAR_PARALLAX, w));
  });
});

describe('game frame and the debug bird size', () => {
  const lane = MOBILE1.modes.normal;

  it('a portrait phone fits the lane width; a wide window fits the lane and the ground', () => {
    const phone = laneFrame(lane.laneW, lane.laneH, 390, 844);
    expect(phone.halfW).toBeCloseTo(lane.laneW / 2, 9);
    expect(phone.halfH * 2).toBeGreaterThanOrEqual(lane.laneH);
    const wide = laneFrame(lane.laneW, lane.laneH, 1280, 800);
    expect(wide.cy + wide.halfH).toBeCloseTo(lane.laneH / 2, 9); // the roof is the top edge
    expect(wide.halfW * 2).toBeGreaterThan(lane.laneW);
    expect(phone.cy).toBe(wide.cy);
    expect(phone.cy).toBeLessThan(0);
  });

  it('birdScale is 1 unless a positive number, and stays between 0.5 and 2', () => {
    expect(parseBirdScale(null)).toBe(1);
    expect(parseBirdScale('')).toBe(1);
    expect(parseBirdScale('abc')).toBe(1);
    expect(parseBirdScale('0')).toBe(1);
    expect(parseBirdScale('-1.2')).toBe(1);
    expect(parseBirdScale('1.15')).toBe(1.15);
    expect(parseBirdScale('1.3')).toBe(1.3);
    expect(parseBirdScale('9')).toBe(2);
    expect(parseBirdScale('0.1')).toBe(0.5);
  });
});
