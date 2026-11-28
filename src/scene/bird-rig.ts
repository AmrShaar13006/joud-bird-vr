// Joud's 4-bone rig, added in code when the model loads (master plan, "Joud's movement").
// joud.glb stays untouched: its single mesh becomes a SkinnedMesh whose weights come
// from vertex positions (rig-weights.ts). The code-built glasses and legs (one merged
// mesh, bird.ts) share the skeleton: glasses ride the head bone, legs the body bone.
// Two skinned meshes, two draw calls, as before. No @iwsdk imports; render code only.
//
// Prototype (feat/joud-rig-spike): used by the ?debug=1&rig=1 view only, not the game yet.

import {
  Bone,
  type BufferGeometry,
  Euler,
  Float32BufferAttribute,
  Group,
  type Material,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
} from 'three';
import {
  BONE_COUNT,
  computeWeights,
  measureRig,
  type RigLandmarks,
  type RigWeights,
  rigidWeights,
  SHOULDER_BLEND,
  type ShoulderBlend,
} from './rig-weights';

const DEG = Math.PI / 180;

/**
 * Folded rest pose of the left wing (+X), applied as: down about Z, then swept back about
 * Y, then rolled about the wing's own length. With the hinge below (WING_HINGE_DOWN), 70°
 * down and 20° back is the lowest fold that keeps every wing vertex outside the body
 * (rig view's penetration check: 75° pushes the wing ~0.02 into the belly).
 */
export const FOLD = { downDeg: 70, backDeg: 20, rollDeg: 0 };

/**
 * Where the left wing hinges when it goes down, as an offset from the measured shoulder
 * point (shoulder line, wing axis). Turning about the wing's own axis would swing the
 * root's underside into the belly (which is wider than the shoulders); hinging lower and
 * a little further out swings it out instead. Going up, the hinge stays on the axis, so
 * the root's top doesn't push into the shoulder. The hinge slides between the two with the
 * downward angle (and the fold), so a beat stays smooth.
 */
export const WING_HINGE_DOWN = { dx: 0.04, dy: -0.1 };

const Z = new Vector3(0, 0, 1);
const Y = new Vector3(0, 1, 0);
const X = new Vector3(1, 0, 0);

/**
 * x, y, z per vertex. GLTFLoader gives joud.glb's position as an interleaved attribute
 * (position, normal and uv in one buffer), so its .array is not positions only.
 */
function packedPositions(geometry: BufferGeometry): Float32Array {
  const attr = geometry.getAttribute('position');
  const out = new Float32Array(attr.count * 3);
  for (let i = 0; i < attr.count; i++) {
    out[i * 3] = attr.getX(i);
    out[i * 3 + 1] = attr.getY(i);
    out[i * 3 + 2] = attr.getZ(i);
  }
  return out;
}

export class BirdRig {
  readonly root = new Group();
  readonly landmarks: RigLandmarks;
  readonly body = new Bone();
  readonly head = new Bone();
  readonly wingL = new Bone();
  readonly wingR = new Bone();
  readonly skeleton: Skeleton;
  readonly mesh: SkinnedMesh;
  readonly extras: SkinnedMesh;
  private blend: ShoulderBlend;
  private readonly weights: RigWeights;
  private readonly positions: ArrayLike<number>;

  // pose state and scratch (no allocation in the setters)
  private angleL = 0;
  private angleR = 0;
  private fold = 1;
  private readonly foldQ = new Quaternion();
  private readonly beatQ = new Quaternion();
  private readonly tmpQ = new Quaternion();
  private readonly headEuler = new Euler(0, 0, 0, 'YXZ');
  private readonly hinge = new Vector3(WING_HINGE_DOWN.dx, WING_HINGE_DOWN.dy, 0);
  private readonly off = new Vector3();

  constructor(
    geometry: BufferGeometry,
    material: Material,
    extrasGeometry: BufferGeometry,
    extrasMaterial: Material,
    blend: ShoulderBlend = SHOULDER_BLEND,
  ) {
    this.root.name = 'BirdRig';
    this.blend = blend;
    this.positions = packedPositions(geometry);
    const lm = measureRig(this.positions);
    this.landmarks = lm;

    // Bones: body at the model origin (the brief's pivot), the rest at the measured joints.
    this.body.name = 'body';
    this.head.name = 'head';
    this.wingL.name = 'wingL';
    this.wingR.name = 'wingR';
    this.head.position.set(0, lm.neckY, 0);
    this.wingL.position.set(lm.shoulderX, lm.wingY, lm.wingZ);
    this.wingR.position.set(-lm.shoulderX, lm.wingY, lm.wingZ);
    this.body.add(this.head, this.wingL, this.wingR);
    this.root.add(this.body);
    this.root.updateMatrixWorld(true);
    // Order matches BONE in rig-weights.ts.
    const bones = [this.body, this.head, this.wingL, this.wingR];
    if (bones.length !== BONE_COUNT) throw new Error('bone count');
    this.skeleton = new Skeleton(bones);

    this.weights = computeWeights(this.positions, lm, blend);
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(this.weights.joints, 4));
    geometry.setAttribute('skinWeight', new Float32BufferAttribute(this.weights.weights, 4));
    this.mesh = new SkinnedMesh(geometry, material);
    this.mesh.name = 'JoudSkinned';

    const rigid = rigidWeights(packedPositions(extrasGeometry), lm.neckY);
    extrasGeometry.setAttribute('skinIndex', new Uint16BufferAttribute(rigid.joints, 4));
    extrasGeometry.setAttribute('skinWeight', new Float32BufferAttribute(rigid.weights, 4));
    this.extras = new SkinnedMesh(extrasGeometry, extrasMaterial);
    this.extras.name = 'JoudGlassesLegsSkinned';

    for (const m of [this.mesh, this.extras]) {
      // Bounds of the bind pose don't cover a folded or raised wing; the bird is small
      // and always on screen, so skip culling rather than recompute bounds per frame.
      m.frustumCulled = false;
      this.root.add(m);
      m.updateMatrixWorld(true);
      m.bind(this.skeleton, m.matrixWorld);
    }

    this.setFoldPose(FOLD.downDeg, FOLD.backDeg, FOLD.rollDeg);
  }

  /** The folded pose of the left wing (the right one mirrors it), degrees: see FOLD. */
  setFoldPose(downDeg: number, backDeg: number, rollDeg: number): void {
    this.foldQ
      .setFromAxisAngle(Y, backDeg * DEG)
      .multiply(this.tmpQ.setFromAxisAngle(Z, -downDeg * DEG))
      .multiply(this.tmpQ.setFromAxisAngle(X, rollDeg * DEG));
    this.applyWings();
  }

  get shoulderBlend(): ShoulderBlend {
    return this.blend;
  }

  /** Swap the shoulder blend (debug comparison): recomputes the weights in place. */
  setShoulderBlend(blend: ShoulderBlend): void {
    this.blend = blend;
    computeWeights(this.positions, this.landmarks, blend, this.weights);
    this.mesh.geometry.getAttribute('skinWeight').needsUpdate = true;
    this.mesh.geometry.getAttribute('skinIndex').needsUpdate = true;
  }

  /**
   * Wing beat angle in degrees about the forward axis: 0 = as modelled (straight out),
   * positive = tips up. The right wing mirrors the left unless given its own angle.
   */
  setWingAngle(leftDeg: number, rightDeg = leftDeg): void {
    this.angleL = leftDeg;
    this.angleR = rightDeg;
    this.applyWings();
  }

  /** 0 = the beat angle, 1 = folded against the body (the rest pose). */
  setWingFold(t: number): void {
    this.fold = Math.min(1, Math.max(0, t));
    this.applyWings();
  }

  /** Move the downward hinge (debug tuning), as an offset like WING_HINGE_DOWN. */
  setDownHinge(dx: number, dy: number): void {
    this.hinge.set(dx, dy, 0);
    this.applyWings();
  }

  /** Head pitch (positive = looks up) and yaw (positive = turns to its left), degrees. */
  setHead(pitchDeg: number, yawDeg: number): void {
    this.headEuler.set(-pitchDeg * DEG, yawDeg * DEG, 0);
    this.head.quaternion.setFromEuler(this.headEuler);
  }

  /** Squash on a flap, as in bird.ts: 1 = full squash, 0 = none. Head and wings follow. */
  setBodySquash(s: number): void {
    this.body.scale.set(1 + 0.1 * s, 1 - 0.18 * s, 1 + 0.1 * s);
  }

  private applyWings(): void {
    const lm = this.landmarks;
    // Left wing (+X): tips up = positive rotation about +Z.
    this.beatQ.setFromAxisAngle(Z, this.angleL * DEG);
    this.wingL.quaternion.copy(this.beatQ).slerp(this.foldQ, this.fold);
    this.placeWing(this.wingL, lm.shoulderX, this.angleL, 1);
    // Right wing: the mirror image across the x = 0 plane, (x, y, z, w) → (x, −y, −z, w).
    this.beatQ.setFromAxisAngle(Z, this.angleR * DEG);
    this.tmpQ.set(this.foldQ.x, -this.foldQ.y, -this.foldQ.z, this.foldQ.w);
    this.wingR.quaternion.set(this.beatQ.x, -this.beatQ.y, -this.beatQ.z, this.beatQ.w).slerp(this.tmpQ, this.fold);
    this.placeWing(this.wingR, -lm.shoulderX, this.angleR, -1);
  }

  /**
   * Turn the wing about its sliding hinge c instead of the bone's own point s:
   * position = c + R (s − c) = s + o − R o, with o = c − s (mirrored in x for the right wing).
   */
  private placeWing(bone: Bone, shoulderX: number, angleDeg: number, side: 1 | -1): void {
    const down = this.fold + (1 - this.fold) * Math.min(1, Math.max(0, -angleDeg / 60));
    this.off.set(this.hinge.x * side * down, this.hinge.y * down, 0);
    bone.position.set(shoulderX, this.landmarks.wingY, this.landmarks.wingZ).add(this.off);
    this.off.applyQuaternion(bone.quaternion);
    bone.position.sub(this.off);
  }
}
