// Joud, the campaign's bird (العصفورة جود). Shared by both shells.
// Look comes only from docs/joud-brief.json: palette, proportions, landmarks.
// Everything is built in the GLB's model units (body radius ~0.6, +Z = front)
// and scaled by 0.2, so the glasses and legs fit both the GLB and the placeholder.

import {
  type BufferGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  Group,
  type Material,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Game } from '../core/game';

/** Brief palette (docs/joud-brief.json → palette). */
const C = {
  cream: '#FCF1EA',
  vest: '#FCE3C6',
  green: '#248F59',
  peach: '#FFC59B',
  glasses: '#555655',
  legs: '#111111',
};

export const MODEL_SCALE = 0.2;
const FACING_Y = (-55 * Math.PI) / 180;
const DEG = Math.PI / 180;

/** Brief landmarks, model units. */
const LEFT_EYE = new Vector3(-0.087, 0.527, 0.23);
const RIGHT_EYE = new Vector3(0.084, 0.529, 0.229);

const tmpM = new Matrix4();
const tmpQ = new Quaternion();
const tmpS = new Vector3();
const tmpP = new Vector3();

/** Bake a transform and a flat vertex colour into a geometry (for merging). */
function part(
  geo: BufferGeometry,
  color: string,
  pos: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1],
  rot: [number, number, number] = [0, 0, 0],
  quat?: Quaternion,
): BufferGeometry {
  tmpQ.copy(quat ?? new Quaternion().setFromEuler(new Euler(rot[0], rot[1], rot[2])));
  tmpM.compose(tmpP.set(pos[0], pos[1], pos[2]), tmpQ, tmpS.set(scale[0], scale[1], scale[2]));
  geo.applyMatrix4(tmpM);
  const c = new Color(color);
  const n = geo.getAttribute('position').count;
  const cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    cols[i * 3] = c.r;
    cols[i * 3 + 1] = c.g;
    cols[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new Float32BufferAttribute(cols, 3));
  geo.deleteAttribute('uv');
  return geo;
}

/** A thin cylinder from `from` along `dir` (normalised) for `len`. */
function rod(from: Vector3, dir: Vector3, len: number, r: number, color: string): BufferGeometry {
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir);
  const mid = from.clone().addScaledVector(dir, len / 2);
  return part(new CylinderGeometry(r, r, len, 5, 1, true), color, [mid.x, mid.y, mid.z], [1, 1, 1], [0, 0, 0], q);
}

/**
 * Placeholder Joud from primitives (< 1,000 triangles): flattened cream body,
 * merged cream head, vest band with green collar, cream wings with peach tips,
 * small peach tail, dot eyes, beak and blush.
 */
export function buildPlaceholderGeometry(): BufferGeometry {
  const parts = [
    part(new SphereGeometry(0.55, 14, 8), C.cream, [0, -0.17, 0], [1.1, 0.95, 1]),
    part(new SphereGeometry(0.27, 12, 8), C.cream, [0, 0.43, 0]),
    // vest: a slightly larger band of the body ellipsoid, from the collar to the belly
    part(
      new SphereGeometry(0.565, 14, 5, 0, Math.PI * 2, 0.16 * Math.PI, 0.44 * Math.PI),
      C.vest,
      [0, -0.17, 0],
      [1.1, 0.95, 1],
    ),
    part(new TorusGeometry(0.26, 0.045, 4, 16), C.green, [0, 0.3, 0], [1, 1, 1], [Math.PI / 2, 0, 0]),
    part(new SphereGeometry(0.3, 8, 4), C.cream, [0.5, 0.02, -0.02], [1.5, 0.35, 0.8]),
    part(new SphereGeometry(0.3, 8, 4), C.cream, [-0.5, 0.02, -0.02], [1.5, 0.35, 0.8]),
    part(new SphereGeometry(0.15, 6, 4), C.peach, [0.85, 0.02, -0.02], [1.2, 0.5, 1.1]),
    part(new SphereGeometry(0.15, 6, 4), C.peach, [-0.85, 0.02, -0.02], [1.2, 0.5, 1.1]),
    part(new SphereGeometry(0.12, 6, 4), C.peach, [0, -0.25, -0.6], [1, 0.6, 1.6]),
    part(new SphereGeometry(0.022, 4, 3), C.legs, [LEFT_EYE.x, LEFT_EYE.y, 0.236]),
    part(new SphereGeometry(0.022, 4, 3), C.legs, [RIGHT_EYE.x, RIGHT_EYE.y, 0.236]),
    part(new SphereGeometry(0.02, 4, 3), C.legs, [-0.002, 0.493, 0.262]),
    part(new SphereGeometry(0.035, 4, 3), C.peach, [0.15, 0.48, 0.215], [1, 0.6, 0.4]),
    part(new SphereGeometry(0.035, 4, 3), C.peach, [-0.15, 0.48, 0.215], [1, 0.6, 0.4]),
  ];
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error('placeholder merge failed');
  return merged;
}

/**
 * Glasses (two #555655 torus rings + bridge, from the eye landmarks and
 * glasses_hint) and legs (thin black cylinders with three toes, trailing
 * backwards and down, from legs_hint). One merged mesh = one draw call.
 * The ring tube is 0.012 (hint ~0.008) so the wire stays visible at 2.5 m.
 */
export function buildExtrasGeometry(): BufferGeometry {
  const ringR = 0.065;
  const parts: BufferGeometry[] = [
    part(new TorusGeometry(ringR, 0.012, 6, 20), C.glasses, [LEFT_EYE.x, LEFT_EYE.y, 0.26], [1, 1, 1], [0, -17 * DEG, 0]),
    part(new TorusGeometry(ringR, 0.012, 6, 20), C.glasses, [RIGHT_EYE.x, RIGHT_EYE.y, 0.26], [1, 1, 1], [0, 17 * DEG, 0]),
  ];
  // bridge between the inner edges of the rings, above the beak
  const bridgeFrom = new Vector3(LEFT_EYE.x + ringR - 0.005, 0.54, 0.268);
  const bridgeLen = RIGHT_EYE.x - ringR + 0.005 - bridgeFrom.x;
  parts.push(rod(bridgeFrom, new Vector3(1, 0, 0), bridgeLen, 0.009, C.glasses));

  // legs: from under the body, trailing backwards (-Z) and down, three toes each
  const legDir = new Vector3(0, -0.8, -1).normalize();
  const side = new Vector3(1, 0, 0);
  for (const x of [-0.15, 0.15]) {
    const hip = new Vector3(x, -0.62, -0.05);
    const legLen = 0.42;
    parts.push(rod(hip, legDir, legLen, 0.02, C.legs));
    const ankle = hip.clone().addScaledVector(legDir, legLen);
    for (const k of [-0.55, 0, 0.55]) {
      const toe = legDir.clone().addScaledVector(side, k).normalize();
      parts.push(rod(ankle, toe, 0.11, 0.013, C.legs));
    }
  }
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error('extras merge failed');
  return merged;
}

export type BirdStatus = 'placeholder' | 'loading' | 'joud' | `error: ${string}`;

const FLASH = new Color('#FE7A45'); // brief orange trim: a warm, soft flash

/**
 * The bird: `root` sits at the bird's lane position (tilt, squash and bob
 * happen there); `model` turns it -55° about Y and scales it to 0.2.
 */
export class Bird {
  readonly root = new Group();
  status: BirdStatus = 'placeholder';
  private readonly model = new Group();
  private readonly placeholder: Mesh<BufferGeometry, MeshLambertMaterial>;
  private readonly extras: Mesh<BufferGeometry, MeshLambertMaterial>;
  private readonly flashMats: MeshLambertMaterial[] = [];
  private squash = 0;
  private flash = 0;

  constructor(private readonly fx: boolean) {
    this.root.name = 'Bird';
    this.model.name = 'BirdModel';
    this.model.rotation.y = FACING_Y;
    this.model.scale.setScalar(MODEL_SCALE);
    const bodyMat = new MeshLambertMaterial({ vertexColors: true });
    this.placeholder = new Mesh(buildPlaceholderGeometry(), bodyMat);
    this.placeholder.name = 'BirdPlaceholder';
    this.extras = new Mesh(buildExtrasGeometry(), new MeshLambertMaterial({ vertexColors: true }));
    this.extras.name = 'BirdGlassesLegs';
    this.flashMats.push(bodyMat);
    this.model.add(this.placeholder, this.extras);
    this.root.add(this.model);
  }

  /** Triangles of the current bird, for reports. */
  get triangles(): number {
    let tris = 0;
    this.model.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || !m.visible) return;
      const g = m.geometry;
      tris += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    });
    return Math.round(tris);
  }

  /**
   * Load the Joud GLB. Its PBR material becomes Lambert (same colour and
   * normal maps, no shine). On any error the placeholder stays and `status`
   * carries the message for the debug HUD.
   */
  async load(url: string): Promise<void> {
    this.status = 'loading';
    try {
      const gltf = await new GLTFLoader().loadAsync(url);
      const scene = gltf.scene;
      let meshes = 0;
      scene.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh) return;
        meshes++;
        const src = m.material as MeshStandardMaterial;
        const mat = new MeshLambertMaterial({
          map: src.map ?? null,
          normalMap: src.normalMap ?? null,
          color: src.color ?? new Color('#ffffff'),
        });
        if (src.normalMap) mat.normalScale.copy(src.normalScale);
        (src as Material).dispose();
        m.material = mat;
        this.flashMats.push(mat);
      });
      if (meshes === 0) throw new Error('no meshes in GLB');
      this.model.add(scene);
      this.placeholder.visible = false;
      this.status = 'joud';
    } catch (err) {
      this.placeholder.visible = true;
      this.status = `error: ${String((err as Error)?.message ?? err).slice(0, 40)}`;
    }
  }

  onFlap(): void {
    this.squash = 1;
  }

  onHit(): void {
    if (this.fx) this.flash = 1;
  }

  /** Procedural animation: idle bob, squash on flap, tilt ±30°, soft hit flash. */
  update(game: Game, dt: number, time: number): void {
    const idle = game.state === 'attract' || game.state === 'ready';
    this.root.position.y = game.bird.y + (idle ? Math.sin(time * 3) * 0.04 : 0);
    this.squash = Math.max(0, this.squash - dt * 8);
    const s = this.squash;
    this.root.scale.set(1 + 0.1 * s, 1 - 0.18 * s, 1 + 0.1 * s);
    const tilt = Math.max(-1, Math.min(1, game.bird.vy / game.cfg.flapVelocity));
    // Facing left (−x): nose up is a clockwise turn seen from the player.
    this.root.rotation.z = game.state === 'playing' ? -tilt * 30 * DEG : 0;
    // One smooth fade (no blinking): peak 0.45, gone in ~0.45 s.
    this.flash = Math.max(0, this.flash - dt * 2.2);
    const k = this.flash * this.flash * 0.45;
    for (const m of this.flashMats) m.emissive.copy(FLASH).multiplyScalar(k);
  }
}

/** The Joud GLB, resolved against the site base so both pages and subpaths work. */
export const JOUD_GLB_URL = `${import.meta.env.BASE_URL}models/joud.glb`;
