// Skin weights for Joud's 4-bone rig, measured from the mesh itself.
// Pure maths: vertex positions in, landmarks and weights out. No three, no DOM,
// so Vitest can run it on positions read straight from joud.glb (rig-weights.test.ts).
//
// Model units, as in joud.glb: +X = Joud's left, +Y up, +Z front (face and vest).
// The wings are thin slabs held straight out to the sides, the head is merged on
// top of the body with the green collar between them (docs/joud-brief.json).

/** Bone order in the skeleton and in the skinIndex attribute. */
export const BONE = { body: 0, head: 1, wingL: 2, wingR: 3 } as const;
export const BONE_COUNT = 4;

/** Wing weight goes from 0 to 1 across this |x| range (the shoulder blend). */
export interface ShoulderBlend {
  inner: number;
  outer: number;
}

/** The default shoulder blend, and the wider one compared in the rig shots. */
export const SHOULDER_BLEND: ShoulderBlend = { inner: 0.45, outer: 0.55 };
export const SHOULDER_BLEND_WIDE: ShoulderBlend = { inner: 0.4, outer: 0.6 };

/**
 * Head weight goes from 0 to 1 across [neckY + below, neckY + above]: from the top of the
 * collar to just under the glasses (their lower rim is at y ≈ 0.46), so the collar stays
 * with the body and the face around the glasses turns fully with the head.
 */
export const NECK_BLEND = { below: -0.035, above: 0.025 };

/** Wing weight fades out between wingRadius and wingRadius + this, away from the wing's axis. */
export const WING_TUBE_FALLOFF = 0.06;

/** Everything measured from the geometry. */
export interface RigLandmarks {
  /** Half the wingspan: max |x|. */
  maxX: number;
  /** Wing centreline height and depth (the axis the wing slab runs along). */
  wingY: number;
  wingZ: number;
  /** Half the wing's height at the tip end. */
  wingHalfHeight: number;
  /** Widest |x| of the body below the wings (the belly). */
  bellyMaxX: number;
  /** Largest distance from the wing axis of any wing vertex outside the belly. */
  wingRadius: number;
  /** Innermost |x| where the cross-section is still as thin as the wing: the shoulder line. */
  shoulderX: number;
  /** Height of the narrowest point between the collar and the face: the neck line. */
  neckY: number;
  /** Top of the head. */
  topY: number;
}

export interface RigWeights {
  /** 4 bone indices per vertex (skinIndex). */
  joints: Uint16Array;
  /** 4 weights per vertex, summing to 1 (skinWeight). */
  weights: Float32Array;
}

/** 0 at a, 1 at b, smooth in between (GLSL smoothstep). */
export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const BIN = 0.02;

/**
 * Measure the landmarks from vertex positions (x, y, z per vertex).
 * 1. Wing tips (|x| above 80 % of the span; only wing there) give the wing's height band.
 * 2. Below that band the widest |x| is the belly; everything further out is wing,
 *    and its largest distance from the wing axis is the wing's radius.
 * 3. Scanning |x| inwards inside the wing band, the shoulder is the last bin whose
 *    cross-section still fits inside the wing radius: further in, the body starts.
 * 4. Between the top of the wings and the face, the narrowest stretch (radial extent
 *    sqrt(x² + z²)) is the neck: just above the collar, just under the glasses.
 */
export function measureRig(pos: ArrayLike<number>): RigLandmarks {
  const n = pos.length / 3;
  let maxX = 0;
  let topY = -Infinity;
  for (let i = 0; i < n; i++) {
    maxX = Math.max(maxX, Math.abs(pos[i * 3]));
    topY = Math.max(topY, pos[i * 3 + 1]);
  }

  // 1. wing band from the tips
  const tipX = maxX * 0.8;
  let tipMinY = Infinity;
  let tipMaxY = -Infinity;
  let tipZ = 0;
  let tipN = 0;
  for (let i = 0; i < n; i++) {
    if (Math.abs(pos[i * 3]) < tipX) continue;
    tipMinY = Math.min(tipMinY, pos[i * 3 + 1]);
    tipMaxY = Math.max(tipMaxY, pos[i * 3 + 1]);
    tipZ += pos[i * 3 + 2];
    tipN++;
  }
  const wingY = (tipMinY + tipMaxY) / 2;
  const wingHalfHeight = (tipMaxY - tipMinY) / 2;
  const wingZ = tipN > 0 ? tipZ / tipN : 0;

  // 2. belly width below the band, wing radius beyond it
  let bellyMaxX = 0;
  for (let i = 0; i < n; i++) {
    if (pos[i * 3 + 1] < wingY - 2 * wingHalfHeight) bellyMaxX = Math.max(bellyMaxX, Math.abs(pos[i * 3]));
  }
  let wingRadius = 0;
  for (let i = 0; i < n; i++) {
    if (Math.abs(pos[i * 3]) <= bellyMaxX + BIN) continue;
    const dy = pos[i * 3 + 1] - wingY;
    const dz = pos[i * 3 + 2] - wingZ;
    wingRadius = Math.max(wingRadius, Math.sqrt(dy * dy + dz * dz));
  }

  // 3. shoulder: scan |x| bins inwards while the band's cross-section fits the wing
  let shoulderX = bellyMaxX;
  for (let lo = bellyMaxX; lo > 0; lo -= BIN) {
    let thick = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
      const ax = Math.abs(pos[i * 3]);
      if (ax < lo || ax >= lo + BIN) continue;
      if (Math.abs(pos[i * 3 + 1] - wingY) > wingRadius) continue;
      thick = Math.max(thick, Math.abs(pos[i * 3 + 2] - wingZ));
      count++;
    }
    if (count === 0 || thick > wingRadius) break;
    shoulderX = lo;
  }

  // 4. neck: the narrowest stretch between the top of the wing band and 0.2 under the head
  //    top, in 0.01 bins. The mesh leaves a ring-free gap here (the collar's top ring, then
  //    nothing until the face), so the neck is the middle of the run of bins within 1.5 % of
  //    the narrowest one. Empty bins inside that gap count as part of the run.
  const NB = 0.01;
  const from = wingY + wingRadius;
  const bins = Math.max(0, Math.floor((topY - 0.2 - from) / NB));
  const radius = new Float64Array(bins).fill(-1); // -1 = too few vertices to count
  for (let b = 0; b < bins; b++) {
    const lo = from + b * NB;
    let r = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
      const y = pos[i * 3 + 1];
      if (y < lo || y >= lo + NB) continue;
      const x = pos[i * 3];
      const z = pos[i * 3 + 2];
      r = Math.max(r, Math.sqrt(x * x + z * z));
      count++;
    }
    if (count >= 4) radius[b] = r;
  }
  let minB = -1;
  for (let b = 0; b < bins; b++) if (radius[b] >= 0 && (minB < 0 || radius[b] < radius[minB])) minB = b;
  let neckY = from;
  if (minB >= 0) {
    const limit = radius[minB] * 1.015;
    let first = minB;
    let last = minB;
    while (first > 0 && radius[first - 1] <= limit) first--;
    while (last < bins - 1 && radius[last + 1] <= limit) last++;
    neckY = from + ((first + last + 1) / 2) * NB;
  }

  return { maxX, wingY, wingZ, wingHalfHeight, bellyMaxX, wingRadius, shoulderX, neckY, topY };
}

/** Raw bone weights of one vertex (before packing): head, wing on its side. */
function vertexWeights(
  x: number,
  y: number,
  z: number,
  lm: RigLandmarks,
  blend: ShoulderBlend,
): { head: number; wing: number } {
  const dy = y - lm.wingY;
  const dz = z - lm.wingZ;
  const d = Math.sqrt(dy * dy + dz * dz);
  // Across the shoulder by |x|, and only inside the wing's tube: keeps the vest's
  // front and back and the belly's sides (which reach further out than the
  // shoulders) on the body.
  const wing =
    smoothstep(blend.inner, blend.outer, Math.abs(x)) * (1 - smoothstep(lm.wingRadius, lm.wingRadius + WING_TUBE_FALLOFF, d));
  const head = Math.min(1 - wing, smoothstep(lm.neckY + NECK_BLEND.below, lm.neckY + NECK_BLEND.above, y));
  return { head, wing };
}

/** Skin weights for the Joud mesh: body takes whatever the head and wings don't. */
export function computeWeights(
  pos: ArrayLike<number>,
  lm: RigLandmarks,
  blend: ShoulderBlend = SHOULDER_BLEND,
  out?: RigWeights,
): RigWeights {
  const n = pos.length / 3;
  const joints = out?.joints ?? new Uint16Array(n * 4);
  const weights = out?.weights ?? new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3];
    const { head, wing } = vertexWeights(x, pos[i * 3 + 1], pos[i * 3 + 2], lm, blend);
    const o = i * 4;
    joints[o] = BONE.body;
    joints[o + 1] = BONE.head;
    joints[o + 2] = x >= 0 ? BONE.wingL : BONE.wingR;
    joints[o + 3] = BONE.body;
    weights[o] = 1 - head - wing;
    weights[o + 1] = head;
    weights[o + 2] = wing;
    weights[o + 3] = 0;
  }
  return { joints, weights };
}

/**
 * Rigid weights for the code-built extras (glasses and legs, one merged mesh):
 * above the neck line follows the head, the rest the body.
 */
export function rigidWeights(pos: ArrayLike<number>, neckY: number): RigWeights {
  const n = pos.length / 3;
  const joints = new Uint16Array(n * 4);
  const weights = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    joints[i * 4] = pos[i * 3 + 1] > neckY ? BONE.head : BONE.body;
    weights[i * 4] = 1;
  }
  return { joints, weights };
}

/** One line for logs and the debug overlay. */
export function describeRig(lm: RigLandmarks, blend: ShoulderBlend): string {
  const f = (v: number) => v.toFixed(3);
  return (
    `shoulder |x|=${f(lm.shoulderX)} wing axis y=${f(lm.wingY)} z=${f(lm.wingZ)} r=${f(lm.wingRadius)} ` +
    `belly |x|=${f(lm.bellyMaxX)} neck y=${f(lm.neckY)} | blend |x| ${blend.inner}-${blend.outer}, ` +
    `head y ${f(lm.neckY + NECK_BLEND.below)}-${f(lm.neckY + NECK_BLEND.above)}`
  );
}
