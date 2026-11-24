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

const lane = MOBILE1.modes.normal;

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
