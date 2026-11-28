// Joud v2 (public/models/joud-v2.glb) as the game's bird, behind ?model=v2 (Amr, 28 Nov 2026).
// The default stays v1 (src/scene/bird.ts, shared with the VR pages, unchanged).
//
// Loaded by main.ts through a dynamic import() only when ?model=v2 is on, so it is its own chunk
// and the first load doesn't change. Rendering only: it reads the game's state and never
// changes it, so the hitbox, the rulesets and the sim are untouched.
//
// The clips follow the game the way the model viewer's tap demo plays them (joud-clips.ts):
// idle on the home and ready screens, flap on every flap, glide when it ends, fall when the bird
// sinks fast, crash on contact. The root moves as bird.ts moves v1's (tilt with the vertical
// speed, squash on a flap, the hit flash with effects on); v2 turns -45° about Y and leans 14°
// towards the camera on a wrapper above the root, as in the viewer.

import { Color, Group, type Mesh, MeshLambertMaterial, type MeshStandardMaterial, type Material, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Game } from '../core/game';
import { type Clip, createMixer, FALL_SHARE, JoudClips, PRESENT_TILT, SQUASH, TILT_MAX, V2_TURN } from './joud-clips';
import type { GameBird } from './view';

const DEG = Math.PI / 180;
/** bird.ts: the model's scale under the root. */
const MODEL_SCALE = 0.2;
/** bird.ts FLASH: a brief, warm orange on a hit. */
const HIT_FLASH = new Color('#FE7A45');

export class JoudV2Bird implements GameBird {
  /** The wrapper that leans the bird towards the camera; its origin is the hitbox centre. */
  readonly root = new Group();
  /** bird.ts's root: tilt and squash. */
  private readonly stage = new Group();
  /** The turn about Y and the model's scale. */
  private readonly facing = new Group();
  private clips: JoudClips | null = null;
  private material: MeshLambertMaterial | null = null;
  private squash = 0;
  private flash = 0;
  /** Seconds of play, for the gap between flaps (stops while paused). */
  private clock = 0;
  private wasPlaying = false;
  private triangleCount = 0;

  constructor(private readonly fx: boolean) {
    this.root.name = 'BirdV2';
    this.root.rotation.x = PRESENT_TILT * DEG;
    this.facing.rotation.y = V2_TURN * DEG;
    this.facing.scale.setScalar(MODEL_SCALE);
    this.stage.add(this.facing);
    this.root.add(this.stage);
  }

  /** For the debug HUD: v2 and the clip in the lead. */
  get status(): string {
    return this.clips ? `v2 ${this.clips.lead?.clip ?? ''}` : 'v2 loading';
  }

  get triangles(): number {
    return this.triangleCount;
  }

  /** Load the GLB; its PBR material becomes Lambert with the same maps, as in the viewer. */
  async load(url: string): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(url);
    const scene: Object3D = gltf.scene;
    let mesh: Mesh | null = null;
    let loops: Record<string, { loop?: boolean }> | undefined;
    scene.traverse((o) => {
      if (!mesh && (o as Mesh).isMesh) mesh = o as Mesh;
      const ex = (o.userData as { joud?: { clips?: Record<string, { loop?: boolean }> } }).joud;
      if (ex?.clips) loops = ex.clips; // build_joud.py: each clip's loop flag
    });
    if (!mesh) throw new Error('no mesh in joud-v2.glb');
    const m = mesh as Mesh;
    const src = m.material as MeshStandardMaterial;
    this.material = new MeshLambertMaterial({ map: src.map ?? null, normalMap: src.normalMap ?? null });
    (src as Material).dispose();
    m.material = this.material;
    const g = m.geometry;
    this.triangleCount = Math.round((g.index ? g.index.count : g.getAttribute('position').count) / 3);
    const clips = new JoudClips(createMixer(scene), gltf.animations, (c: Clip) => loops?.[c]?.loop);
    if (!clips.complete) throw new Error('joud-v2.glb: clips missing');
    this.clips = clips;
    this.facing.add(scene);
    clips.ready();
    clips.update(0);
  }

  onFlap(): void {
    this.squash = 1;
    // The first flap of a round starts it (ready -> playing): speed 1, as in the tap demo.
    this.clips?.tap(this.clock, !this.wasPlaying);
    this.wasPlaying = true;
  }

  onHit(): void {
    if (this.fx) this.flash = 1;
    this.clips?.crash();
  }

  update(game: Game, dt: number, _time: number): void {
    const clips = this.clips;
    const state = game.state;
    if (state === 'paused') return; // the pose holds still
    this.clock += dt;
    if (clips) {
      if (state === 'attract' || state === 'ready') {
        if (this.wasPlaying || clips.lead?.clip !== 'idle') clips.ready();
        this.wasPlaying = false;
      } else if (state === 'playing') {
        clips.follow(game.bird.vy, FALL_SHARE * game.cfg.maxFall);
      } else if (state === 'gameOver') {
        clips.crash(); // also a round that ends without a hit event
      }
      clips.update(dt);
    }
    // bird.ts: squash on a flap, tilt with the vertical speed while playing.
    this.squash = Math.max(0, this.squash - dt * SQUASH.fade);
    const s = this.squash;
    this.stage.scale.set(1 + SQUASH.wide * s, 1 - SQUASH.flat * s, 1 + SQUASH.wide * s);
    const tilt = Math.max(-1, Math.min(1, game.bird.vy / game.cfg.flapVelocity));
    this.stage.rotation.z = state === 'playing' ? -tilt * TILT_MAX * DEG : 0; // facing left: nose up is clockwise
    this.flash = Math.max(0, this.flash - dt * 2.2);
    const k = this.flash * this.flash * 0.45;
    if (this.material) this.material.emissive.copy(HIT_FLASH).multiplyScalar(k);
  }
}

/** The v2 bird, loaded; rejects if the GLB fails (the caller keeps the bird it has). */
export async function loadJoudV2(url: string, fx: boolean): Promise<JoudV2Bird> {
  const bird = new JoudV2Bird(fx);
  await bird.load(url);
  return bird;
}
