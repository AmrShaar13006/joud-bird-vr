// Checks public/models/joud-v2.glb (built by tools/blender/build_joud.py) against the task's
// budget and contract: size, one mesh and material, the rig, the sockets, the folded pose,
// a 1024 px WebP atlas and the five animation clips (names, lengths, no key on the root, flap
// ending on glide, loops closing, the glasses' tilt in the crash). Parses the GLB by hand: no
// loader needed.
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const FILE = resolve(__dirname, '../../public/models/joud-v2.glb');

type Path = 'translation' | 'rotation' | 'scale' | 'weights';

interface Gltf {
  nodes: {
    name?: string;
    extras?: { joud?: JoudExtras };
    children?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
  }[];
  meshes: { primitives: { indices?: number; material?: number; attributes: Record<string, number> }[] }[];
  materials: unknown[];
  skins: { joints: number[] }[];
  accessors: { count: number; type: string; componentType: number; bufferView?: number; byteOffset?: number; max?: number[] }[];
  bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[];
  images: { mimeType?: string; bufferView?: number }[];
  animations?: {
    name: string;
    channels: { sampler: number; target: { node: number; path: Path } }[];
    samplers: { input: number; output: number; interpolation?: string }[];
  }[];
}

interface JoudExtras {
  poses: Record<string, Record<string, number[]>>;
  poses_scale: Record<string, Record<string, number[]>>;
  clips: Record<string, { frames: number; fps: number; loop: boolean }>;
  green_edge: Record<'L' | 'R', { faces: string }>;
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

const WING = ['wing_shoulder', 'wing_mid', 'wing_tip', 'wing_fan'];
const JOINTS = [
  'root',
  'body',
  'head',
  'eye_ctrl',
  'glasses',
  ...['L', 'R'].flatMap((s) => WING.map((b) => `${b}_${s}`)),
  'leg_upper_L',
  'leg_lower_L',
  'leg_upper_R',
  'leg_lower_R',
];
const SOCKETS = ['head_top', 'eyes', 'neck', 'chest', 'back', 'feet'].map((s) => `socket_${s}`);

const FPS = 24;
// name -> [frames at 24 fps, looped]; the names are the contract with the game
const CLIPS: Record<string, [number, boolean]> = {
  idle: [144, true],
  flap: [10, false],
  glide: [29, true],
  fall: [7, true],
  crash: [14, false],
};
const SIZE: Record<string, number> = { SCALAR: 1, VEC3: 3, VEC4: 4 };
const REST: Record<Path, number[]> = { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], weights: [] };

describe('joud-v2.glb', () => {
  const { json, bin } = readGlb();
  const animations = json.animations ?? [];

  /** One float accessor, as rows of its type's size. */
  function rows(index: number): number[][] {
    const acc = json.accessors[index];
    expect(acc.componentType).toBe(5126); // float
    const view = json.bufferViews[acc.bufferView!];
    expect(view.byteStride).toBeUndefined();
    const size = SIZE[acc.type];
    const start = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const out: number[][] = [];
    for (let i = 0; i < acc.count; i++) {
      out.push(Array.from({ length: size }, (_, k) => bin.readFloatLE(start + (i * size + k) * 4)));
    }
    return out;
  }

  /** "bone.path" -> the channel's keys, for one clip. */
  function keysOf(name: string): Map<string, number[][]> {
    const clip = animations.find((a) => a.name === name)!;
    const out = new Map<string, number[][]>();
    for (const ch of clip.channels) {
      out.set(`${json.nodes[ch.target.node].name}.${ch.target.path}`, rows(clip.samplers[ch.sampler].output));
    }
    return out;
  }

  /** A bone's value where a clip does not key it: the bind pose. */
  function rest(key: string): number[] {
    const [bone, path] = key.split('.') as [string, Path];
    const node = json.nodes.find((n) => n.name === bone)!;
    return node[path as 'translation' | 'rotation' | 'scale'] ?? REST[path];
  }

  /** Largest difference between two values; q and -q are the same rotation. */
  function gap(key: string, a: number[], b: number[]): number {
    const flip = key.endsWith('.rotation') && a.reduce((s, v, i) => s + v * b[i], 0) < 0 ? -1 : 1;
    return Math.max(...a.map((v, i) => Math.abs(v - flip * b[i])));
  }

  it('stays under 600 KB', () => {
    expect(statSync(FILE).size).toBeLessThan(600 * 1024);
  });

  it('is one mesh with one material (one draw call), within the brief’s 8000 triangles', () => {
    expect(json.meshes).toHaveLength(1);
    expect(json.meshes[0].primitives).toHaveLength(1);
    expect(json.materials).toHaveLength(1);
    const prim = json.meshes[0].primitives[0];
    expect(prim.attributes).toHaveProperty('JOINTS_0');
    expect(prim.attributes).toHaveProperty('WEIGHTS_0');
    expect(json.accessors[prim.indices!].count / 3).toBeLessThanOrEqual(8000);
  });

  it('has the armature: root, body, head, blink control, glasses, 4 bones per wing, 2 per leg', () => {
    expect(json.skins).toHaveLength(1);
    const names = json.skins[0].joints.map((j) => json.nodes[j].name);
    expect([...names].sort()).toEqual([...JOINTS].sort());
  });

  it('has the six sockets', () => {
    const names = json.nodes.map((n) => n.name);
    for (const s of SOCKETS) expect(names).toContain(s);
  });

  const extras = json.nodes.find((n) => n.extras?.joud)?.extras?.joud;

  it('carries the rest_folded pose and the blink axis', () => {
    expect(extras).toBeDefined();
    const folded = extras!.poses.rest_folded;
    for (const side of ['L', 'R']) {
      for (const bone of WING) {
        const q = folded[`${bone}_${side}`];
        expect(q).toHaveLength(4);
        expect(Math.hypot(...q)).toBeCloseTo(1, 4);
      }
      expect(extras!.poses_scale.rest_folded[`wing_fan_${side}`]).toHaveLength(3);
    }
    expect(extras!.blink.bone).toBe('eye_ctrl');
    expect(Object.keys(extras!.sockets).sort()).toEqual([...SOCKETS].sort());
  });

  it('has the green edge leading on both wings (measured by the build)', () => {
    expect(extras!.green_edge.L.faces).toBe('front');
    expect(extras!.green_edge.R.faces).toBe('front');
  });

  it('has the five clips by name, keyed on every frame at 24 fps', () => {
    expect(animations.map((a) => a.name).sort()).toEqual(Object.keys(CLIPS).sort());
    for (const clip of animations) {
      const [frames, loop] = CLIPS[clip.name];
      expect(extras!.clips[clip.name]).toEqual({ frames, fps: FPS, loop });
      const counts = clip.samplers.map((s) => {
        const input = json.accessors[s.input];
        expect(input.max![0]).toBeCloseTo(frames / FPS, 5); // every channel spans the whole clip
        // a key per frame, or (the exporter's saving) two stepped keys for a value that is held
        expect([2, frames + 1]).toContain(input.count);
        expect(s.interpolation ?? 'LINEAR').toBe(input.count === 2 ? 'STEP' : 'LINEAR');
        return input.count;
      });
      expect(counts).toContain(frames + 1);
    }
  });

  it('never keys the root: the game moves and tilts it', () => {
    const joints = new Set(json.skins[0].joints.map((j) => json.nodes[j].name));
    for (const clip of animations) {
      for (const ch of clip.channels) {
        const bone = json.nodes[ch.target.node].name!;
        expect(bone).not.toBe('root');
        expect(joints.has(bone)).toBe(true);
      }
    }
  });

  it('ends flap on glide’s first frame', () => {
    const flap = keysOf('flap');
    const glide = keysOf('glide');
    for (const key of new Set([...flap.keys(), ...glide.keys()])) {
      const keys = flap.get(key);
      const last = keys ? keys[keys.length - 1] : rest(key);
      const first = glide.get(key)?.[0] ?? rest(key);
      expect(gap(key, last, first), key).toBeLessThan(1e-4);
    }
  });

  it('closes the loops: the last frame of idle, glide and fall is the first', () => {
    for (const [name, [, loop]] of Object.entries(CLIPS)) {
      if (!loop) continue;
      for (const [key, keys] of keysOf(name)) expect(gap(key, keys[0], keys[keys.length - 1]), `${name} ${key}`).toBeLessThan(1e-4);
    }
  });

  it('tilts the glasses by at most 6 degrees in the crash (the lens tint is painted on the face)', () => {
    const keys = keysOf('crash').get('glasses.rotation')!;
    const bind = rest('glasses.rotation');
    const angles = keys.map((q) => {
      const dot = Math.min(1, Math.abs(q.reduce((s, v, i) => s + v * bind[i], 0)));
      return (2 * Math.acos(dot) * 180) / Math.PI;
    });
    expect(Math.max(...angles)).toBeGreaterThan(3);
    expect(Math.max(...angles)).toBeLessThanOrEqual(6.01);
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
