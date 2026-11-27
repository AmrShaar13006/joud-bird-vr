// Checks public/models/joud-v2.glb (built by tools/blender/build_joud.py) against the task's
// budget and contract: size, one mesh and material, the rig, the sockets, the folded pose,
// a 1024 px WebP atlas and no animation clips. Parses the GLB by hand: no loader needed.
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const FILE = resolve(__dirname, '../../public/models/joud-v2.glb');

interface Gltf {
  nodes: { name?: string; extras?: { joud?: JoudExtras }; children?: number[] }[];
  meshes: { primitives: { indices?: number; material?: number; attributes: Record<string, number> }[] }[];
  materials: unknown[];
  skins: { joints: number[] }[];
  accessors: { count: number }[];
  bufferViews: { byteOffset?: number; byteLength: number }[];
  images: { mimeType?: string; bufferView?: number }[];
  animations?: unknown[];
}

interface JoudExtras {
  poses: Record<string, Record<string, number[]>>;
  blink: { bone: string; local_axis: string; closed_scale: number };
  sockets: Record<string, string>;
}

function readGlb(): { json: Gltf; bin: Buffer } {
  const buf = readFileSync(FILE);
  expect(buf.readUInt32LE(0)).toBe(0x46546c67); // 'glTF'
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as Gltf;
  const binStart = 20 + jsonLen;
  const binLen = buf.readUInt32LE(binStart);
  return { json, bin: buf.subarray(binStart + 8, binStart + 8 + binLen) };
}

/** Width and height of a WebP (lossy VP8, lossless VP8L or extended VP8X). */
function webpSize(b: Buffer): [number, number] {
  expect(b.subarray(0, 4).toString('ascii')).toBe('RIFF');
  expect(b.subarray(8, 12).toString('ascii')).toBe('WEBP');
  const chunk = b.subarray(12, 16).toString('ascii');
  if (chunk === 'VP8X') return [b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1];
  if (chunk === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
  }
  return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
}

const JOINTS = [
  'root',
  'body',
  'head',
  'eye_ctrl',
  'wing_shoulder_L',
  'wing_mid_L',
  'wing_tip_L',
  'wing_shoulder_R',
  'wing_mid_R',
  'wing_tip_R',
  'leg_upper_L',
  'leg_lower_L',
  'leg_upper_R',
  'leg_lower_R',
];
const SOCKETS = ['head_top', 'eyes', 'neck', 'chest', 'back', 'feet'].map((s) => `socket_${s}`);

describe('joud-v2.glb', () => {
  const { json, bin } = readGlb();

  it('stays under 600 KB', () => {
    expect(statSync(FILE).size).toBeLessThan(600 * 1024);
  });

  it('is one mesh with one material, within the brief’s 8000 triangles', () => {
    expect(json.meshes).toHaveLength(1);
    expect(json.meshes[0].primitives).toHaveLength(1);
    expect(json.materials).toHaveLength(1);
    const prim = json.meshes[0].primitives[0];
    expect(prim.attributes).toHaveProperty('JOINTS_0');
    expect(prim.attributes).toHaveProperty('WEIGHTS_0');
    expect(json.accessors[prim.indices!].count / 3).toBeLessThanOrEqual(8000);
  });

  it('has the armature: root, body, head, blink control, 3 bones per wing, 2 per leg', () => {
    expect(json.skins).toHaveLength(1);
    const names = json.skins[0].joints.map((j) => json.nodes[j].name);
    expect([...names].sort()).toEqual([...JOINTS].sort());
  });

  it('has the six sockets', () => {
    const names = json.nodes.map((n) => n.name);
    for (const s of SOCKETS) expect(names).toContain(s);
  });

  it('carries the rest_folded pose and the blink axis, and no animation clips', () => {
    const extras = json.nodes.find((n) => n.extras?.joud)?.extras?.joud;
    expect(extras).toBeDefined();
    const folded = extras!.poses.rest_folded;
    for (const side of ['L', 'R']) {
      for (const bone of ['wing_shoulder', 'wing_mid', 'wing_tip']) {
        const q = folded[`${bone}_${side}`];
        expect(q).toHaveLength(4);
        expect(Math.hypot(...q)).toBeCloseTo(1, 4);
      }
    }
    expect(extras!.blink.bone).toBe('eye_ctrl');
    expect(Object.keys(extras!.sockets).sort()).toEqual([...SOCKETS].sort());
    expect(json.animations ?? []).toHaveLength(0);
  });

  it('has a single WebP atlas of at most 1024 px', () => {
    expect(json.images).toHaveLength(1);
    expect(json.images[0].mimeType).toBe('image/webp');
    const view = json.bufferViews[json.images[0].bufferView!];
    const img = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    const [w, h] = webpSize(img);
    expect(Math.max(w, h)).toBeLessThanOrEqual(1024);
    expect(w).toBe(h);
  });
});
