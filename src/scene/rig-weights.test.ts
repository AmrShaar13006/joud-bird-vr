/// <reference types="node" />
// The rig weights on the real joud.glb. Positions are read straight from the GLB's
// JSON and binary chunks (GLTFLoader needs browser APIs for the textures).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BONE,
  computeWeights,
  describeRig,
  measureRig,
  rigidWeights,
  SHOULDER_BLEND,
  SHOULDER_BLEND_WIDE,
  smoothstep,
} from './rig-weights';

interface Gltf {
  accessors: { bufferView: number; byteOffset?: number; count: number; componentType: number; type: string }[];
  bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[];
  meshes: { primitives: { attributes: Record<string, number> }[] }[];
}

/** POSITION of the GLB's first primitive as packed x, y, z floats. */
function readPositions(file: string): Float32Array {
  const buf = readFileSync(file);
  expect(buf.readUInt32LE(0)).toBe(0x46546c67); // 'glTF'
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as Gltf;
  const binStart = 20 + jsonLen + 8; // after the BIN chunk header
  const acc = json.accessors[json.meshes[0].primitives[0].attributes.POSITION];
  expect(acc.type).toBe('VEC3');
  expect(acc.componentType).toBe(5126); // float
  const view = json.bufferViews[acc.bufferView];
  const stride = view.byteStride ?? 12;
  const out = new Float32Array(acc.count * 3);
  const base = binStart + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  for (let i = 0; i < acc.count; i++) {
    for (let k = 0; k < 3; k++) out[i * 3 + k] = buf.readFloatLE(base + i * stride + k * 4);
  }
  return out;
}

const pos = readPositions(resolve('public/models/joud.glb'));
const n = pos.length / 3;
const lm = measureRig(pos);

describe('rig landmarks measured from joud.glb', () => {
  it('reads the model the brief describes', () => {
    expect(n).toBe(6087);
    expect(lm.maxX).toBeCloseTo(0.951, 2);
    expect(lm.topY).toBeCloseTo(0.696, 2);
  });

  it('finds the shoulder, the wing axis and the neck', () => {
    console.log(`[rig] ${describeRig(lm, SHOULDER_BLEND)}`);
    // Wing slab (docs/screens/bird-front.jpg): straight out, centred a little above the vest's middle.
    expect(lm.wingY).toBeGreaterThan(0.15);
    expect(lm.wingY).toBeLessThan(0.3);
    expect(Math.abs(lm.wingZ)).toBeLessThan(0.03);
    // The belly is wider than the shoulders: the reason the wing weight needs a tube gate.
    expect(lm.bellyMaxX).toBeGreaterThan(lm.shoulderX);
    expect(lm.shoulderX).toBeGreaterThan(0.38);
    expect(lm.shoulderX).toBeLessThan(0.5);
    // Neck between the collar (up to y ≈ 0.40) and the eyes (y ≈ 0.53, brief landmarks).
    expect(lm.neckY).toBeGreaterThan(0.38);
    expect(lm.neckY).toBeLessThan(0.5);
  });
});

describe.each([
  ['narrow', SHOULDER_BLEND],
  ['wide', SHOULDER_BLEND_WIDE],
])('rig weights (%s shoulder blend)', (_name, blend) => {
  const { joints, weights } = computeWeights(pos, lm, blend);

  it('sums to 1 per vertex, all weights in [0, 1]', () => {
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        const w = weights[i * 4 + k];
        expect(w).toBeGreaterThanOrEqual(-1e-6);
        expect(w).toBeLessThanOrEqual(1 + 1e-6);
        sum += w;
      }
      expect(Math.abs(sum - 1)).toBeLessThan(1e-5);
    }
  });

  it('puts each wing on its own side and the wing tips fully on the wing', () => {
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3];
      const w = weights[i * 4 + 2];
      if (w > 0) expect(joints[i * 4 + 2]).toBe(x >= 0 ? BONE.wingL : BONE.wingR);
      if (Math.abs(x) > blend.outer && Math.abs(x) > lm.bellyMaxX + 0.02) expect(w).toBeCloseTo(1, 5);
      if (Math.abs(x) < blend.inner) expect(w).toBe(0);
    }
  });

  it('keeps the belly and the vest front and back off the wings', () => {
    for (let i = 0; i < n; i++) {
      const y = pos[i * 3 + 1];
      const z = pos[i * 3 + 2];
      const below = y < lm.wingY - lm.wingRadius - 0.06;
      const frontOrBack = Math.abs(z - lm.wingZ) > lm.wingRadius + 0.06;
      if (below || frontOrBack) expect(weights[i * 4 + 2]).toBe(0);
    }
  });

  it('keeps the collar on the body, turns the face with the head, never mixes head and wing', () => {
    // Collar top ring at y = 0.40 (measured); glasses' lower rim = eye y 0.527 − ring 0.065 (brief).
    const collarTop = 0.401;
    const glassesRim = 0.527 - 0.065;
    for (let i = 0; i < n; i++) {
      const y = pos[i * 3 + 1];
      const head = weights[i * 4 + 1];
      if (y <= collarTop) expect(head).toBe(0);
      if (y >= glassesRim) expect(head).toBeCloseTo(1, 5);
      expect(head * weights[i * 4 + 2]).toBe(0);
    }
  });

  it('is mirror-symmetric', () => {
    // Joud isn't modelled perfectly symmetric, so compare the share of each side.
    let l = 0;
    let r = 0;
    for (let i = 0; i < n; i++) {
      if (joints[i * 4 + 2] === BONE.wingL) l += weights[i * 4 + 2];
      else r += weights[i * 4 + 2];
    }
    console.log(`[rig] ${_name}: wing weight L ${l.toFixed(1)} R ${r.toFixed(1)} of ${n} vertices`);
    expect(Math.abs(l - r) / Math.max(l, r)).toBeLessThan(0.1);
  });
});

describe('helpers', () => {
  it('smoothstep', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(smoothstep(0, 1, 2)).toBe(1);
  });

  it('rigid weights split the extras at the neck', () => {
    const extras = new Float32Array([0, 0.53, 0.26, 0.15, -0.7, -0.2]);
    const { joints, weights } = rigidWeights(extras, lm.neckY);
    expect([joints[0], joints[4]]).toEqual([BONE.head, BONE.body]);
    expect([weights[0], weights[4]]).toEqual([1, 1]);
  });
});
