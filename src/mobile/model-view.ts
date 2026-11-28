// ?debug=1&rig=1&model=v2: Joud's v2 model (public/models/joud-v2.glb, built by
// tools/blender/build_joud.py) on a plain background: still poses next to the official art,
// the five animation clips, and a "tap" demo that plays them the way the game will.
// Loaded by model-gate.ts through a dynamic import(), so it is its own chunk and the game's
// first load doesn't change. Developer-only page: its labels are English, not strings.ts.
//
// URL: &model=v2|v1  &pose=folded|spread|idle|flap|glide|fall|crash|tap
//      &view=front|three-quarter|side|back|face|top|game
//      &ref=1 (the matching official art beside the model)  &look=lambert|toon
//      &sockets=1 (show the customization sockets)  &blink=1  &ui=0 (no controls, for shots)
//      &status=1 (a one-line caption of what is playing, for recordings)
//      &tilt=0..15 (game view: the presentation tilt towards the camera, degrees; 14 by default)
// Game view tests (Amr, 28 Nov 2026):
//      &bg=game (the game's own sky, plaza and ground behind the bird, and the game camera's
//               frame for the window: at 390 x 844 it is a phone's screen)
//      &bg=key (flat magenta in the same frame, so scripts can cut the bird out: model-tests.ts)
//      &birdScale=1.15 (the drawn bird only, as ?debug=1&birdScale= in the game; 0.5 to 2)
//      &turn=-55 (the bird's turn about Y, degrees; by default the game's: -45 for v2 (Amr,
//               28 Nov 2026, joud-v2-bird.ts), -55 for v1 (bird.ts))
//      &laneY=0.6 (stills and single clips: height in the lane, lane units, 0 = centre)
// Screenshot scripts drive it through window.__joudModel (scripts/model-shots.ts,
// scripts/model-anim.ts).
//
// The tap demo runs the game's own physics (src/core/physics.ts, mobile-1 normal) and moves
// the model's root as src/scene/bird.ts does (height, tilt with the vertical speed, squash on a
// flap). The clips never key the root, so the two add up exactly as they will in the game:
//   tap          flap (one stroke), cross-fade 0.08 s; a tap during flap restarts it with a
//                0.05 s cross-fade; taps under 0.3 s apart play it at up to 1.6x speed
//   flap ends    glide (flap's last frame is glide's first)
//   dropping     fall, once the bird sinks faster than 65 % of its terminal speed
//   floor, roof  crash; the next tap goes back to "ready" (idle) at the lane's centre
// (joud-clips.ts holds these rules; the game's ?model=v2 bird, joud-v2-bird.ts, plays them too.)
//
// Presentation tilt (Amr, 28 Nov 2026): the game's camera is level, so a gliding wing is seen
// edge-on. The game view therefore leans the bird 14 degrees towards the camera on a wrapper
// above the root, which shows the top of the wings. The wrapper turns about the root's own
// place, so the game keeps owning the root's position and tilt and the bird stays exactly
// where the physics puts it on screen. The game's ?model=v2 bird has the same wrapper.

import {
  type AnimationClip,
  AnimationMixer,
  AxesHelper,
  BackSide,
  type Bone,
  BufferGeometry,
  Color,
  DataTexture,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  type Material,
  type Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type MeshStandardMaterial,
  MeshToonMaterial,
  NearestFilter,
  type Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  RedFormat,
  Scene,
  SkinnedMesh,
  type Texture,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import refFront from '../../docs/references/joud_ref_round_front.png?url';
import refPoster from '../../docs/references/joud_ref_flying_poster_crop.png?url';
import refSide from '../../docs/references/joud_ref_slim_side.png?url';
import { type Body, flap as coreFlap, integrate } from '../core/physics';
import { MOBILE1 } from '../core/ruleset';
import type { addGameBackdrop, gameBackground, laneFrame, parseBirdScale, scrollBackdrop } from './game-backdrop';
import { CLIPS, type Clip, FALL_SHARE, isClip, JoudClips, PRESENT_TILT, SQUASH, TILT_MAX, V2_TURN } from './joud-clips';

export { CLIPS, type Clip, PRESENT_TILT };

/** The game's backdrop code (game-backdrop.ts), handed over by model-gate.ts: this chunk cannot import it. */
export interface GameBackdropCode {
  addGameBackdrop: typeof addGameBackdrop;
  gameBackground: typeof gameBackground;
  laneFrame: typeof laneFrame;
  parseBirdScale: typeof parseBirdScale;
  scrollBackdrop: typeof scrollBackdrop;
}

export const STILLS = ['folded', 'spread'] as const;
export const POSES = [...STILLS, ...CLIPS, 'tap'] as const;
export const VIEWS = ['front', 'three-quarter', 'side', 'back', 'face', 'top', 'game'] as const;
export const LOOKS = ['lambert', 'toon'] as const;
export type Pose = (typeof POSES)[number];
export type View = (typeof VIEWS)[number];
export type Look = (typeof LOOKS)[number];
export type Background = 'plain' | 'game' | 'key';

export interface ModelInfo {
  model: string;
  pose: Pose;
  view: View;
  look: Look;
  ref: boolean;
  calls: number;
  triangles: number;
  fps: number;
  bytes: number;
  joints: string[];
  sockets: string[];
  clips: { name: string; duration: number; loop: boolean }[];
  /** PRESENT_TILT: the lean the game view shows by default, degrees. */
  presentTilt: number;
  /** The game's turn of this model about Y, degrees: V2_TURN for v2, FACING_TURN for v1. */
  facingTurn: number;
  /** The game view's test settings now. */
  game: { bg: Background; birdScale: number; turn: number; laneY: number; scroll: number };
}

/** What is playing now (the still poses report clip ''). */
export interface AnimState {
  clip: Clip | '';
  /** The leading clip's own time, seconds. */
  time: number;
  /** Tap demo: ready (idle, before the first tap), playing, or over (crashed). */
  phase: 'ready' | 'playing' | 'over';
  /** Tap demo: height in model units above the lane's centre, speed in lane units per second. */
  y: number;
  vy: number;
  /** The root's tilt in degrees, nose up positive. */
  tilt: number;
  taps: number;
  /** Flap playback speed of the last tap (1 to 1.6) and the gap before it, seconds. */
  flapSpeed: number;
  tapGap: number;
}

export interface ModelApi {
  ready: boolean;
  error: string;
  /** Setting `pose` (even to the same one) starts it again from its first frame. */
  set(o: {
    pose?: Pose;
    view?: View;
    look?: Look;
    ref?: boolean;
    ui?: boolean;
    sockets?: boolean;
    blink?: boolean;
    zoom?: number;
    aim?: [number, number, number] | null;
    /** true: time only moves through step() and seek() (recordings). */
    manual?: boolean;
    /** Game view: degrees the bird leans towards the camera (0 to 15). */
    tilt?: number;
    /** Game view: the game's own backdrop and frame, flat magenta in that frame (key), or the plain background. */
    bg?: Background;
    /** Game view: size of the drawn bird (0.5 to 2). */
    birdScale?: number;
    /** Game view: the bird's turn about Y, degrees (-90 to 0). */
    turn?: number;
    /** Game view, stills and single clips: height in the lane, lane units. */
    laneY?: number;
    /** Game view: the backdrop scrolled as after this many lane units of play (0: as with effects off). */
    scroll?: number;
    status?: boolean;
  }): void;
  info(): ModelInfo;
  anim(): AnimState;
  /** One tap of the tap demo (pose 'tap'). */
  tap(): void;
  /** Manual clock: advance everything by dt seconds and draw one frame. */
  step(dt: number): void;
  /** Manual clock, a single clip: show the clip at `time` seconds. */
  seek(time: number): void;
}

interface JoudExtras {
  poses?: Record<string, Record<string, number[]>>;
  poses_scale?: Record<string, Record<string, number[]>>;
  blink?: { bone: string; local_axis: 'x' | 'y' | 'z'; closed_scale: number };
  sockets?: Record<string, string>;
  clips?: Record<string, { frames: number; fps: number; loop: boolean }>;
}

const DEG = Math.PI / 180;
const BG = '#e9eef5';
const KEY = '#ff00ff'; // &bg=key: no colour of Joud's is near it
const OUTLINE = '#3b2a20';
const OUTLINE_WIDTH = 0.011; // model units (the game draws Joud at 0.2 scale)
const SWATCH_V = 0.035; // build_joud.py: 1 - ATLAS_FIT

// --- how the game shows and moves the bird ----------------------------------------------------------
const GAME = MOBILE1.modes.normal;
export const FACING_TURN = -55; // degrees, bird.ts: v1 faces left and a little towards the camera
// Lane units per model unit: bird.ts MODEL_SCALE (0.2) times view.ts's holder scale (birdRadius / 0.12).
const MODEL_UNIT = 0.2 * (GAME.birdRadius / 0.12);
const GAME_HALF_HEIGHT = 4.5; // model units the game view shows above and below its centre
const RULER_STEP = 3; // model units between the game view's guide lines
const LANE_Y_MAX = GAME.laneH / 2 - GAME.birdRadius; // lane units: the highest and lowest the hitbox reaches
const clampTurn = (v: number, fallback: number): number => (Number.isFinite(v) ? Math.max(-90, Math.min(0, v)) : fallback);
const clampLaneY = (v: number): number => (Number.isFinite(v) ? Math.max(-LANE_Y_MAX, Math.min(LANE_Y_MAX, v)) : 0);
const clampScroll = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(1e4, v)) : 0);

// --- how the clips follow each other: joud-clips.ts (shared with the game's ?model=v2 bird) ----------
const FALL_VY = FALL_SHARE * GAME.maxFall; // lane units/s: sinking faster than this is a fall, not a glide
const REPLAY_AFTER: Record<Clip, number> = { idle: 0, flap: 0.7, glide: 0, fall: 0, crash: 1.3 }; // a one-shot's hold

/** Wings down: the poses that match the round front art. */
const wingsDown = (p: Pose): boolean => p === 'folded' || p === 'idle';

/** The official art that matches each view and pose, with a caption. */
function referenceFor(view: View, pose: Pose): { src: string; caption: string } | null {
  if (view === 'back' || view === 'top') return null; // no art from behind or above
  if (view === 'side') return { src: refSide, caption: 'Slim outfit, side (compare silhouette, legs, tail)' };
  if ((view === 'front' && wingsDown(pose)) || view === 'face') return { src: refFront, caption: 'Round outfit, front (wings down)' };
  return { src: refPoster, caption: 'Flying poster (wings spread)' };
}

/** Camera azimuth (about Y, from +Z = front; +90 = Joud's left side), elevation, distance. */
function cameraFor(view: View, pose: Pose): { az: number; el: number; dist: number; y: number } {
  const dist = wingsDown(pose) ? 4.6 : 8.2; // wings out: they span about 3.3
  switch (view) {
    case 'front':
      return { az: 0, el: 4, dist, y: 0.2 };
    // The game turns Joud -55 degrees about Y, which shows its left side and front.
    case 'three-quarter':
      return { az: 55, el: 8, dist, y: 0.2 };
    // Joud's right side, so it faces right like the side art.
    case 'side':
      return { az: -90, el: 4, dist: 4.6, y: 0.2 };
    case 'back':
      return { az: 180, el: 4, dist, y: 0.2 };
    case 'face':
      return { az: 0, el: 2, dist: 1.9, y: 0.78 };
    // Straight down, Joud's front towards the bottom of the picture.
    case 'top':
      return { az: 0, el: 89.9, dist: 8.2, y: 0.2 };
    // The game view has its own camera (straight-on, no perspective): see applyView().
    case 'game':
      return { az: 0, el: 0, dist: 10, y: 0.2 };
  }
}

/** The size and turn buttons step through the values of the 28 Nov tests. */
const SIZES = [1, 1.15, 1.3];
const TURNS = [-55, -45, -40];
const cycle = (list: number[], v: number): number => list[(list.indexOf(v) + 1) % list.length];

function pick<T extends string>(list: readonly T[], v: string | null, fallback: T): T {
  return list.includes(v as T) ? (v as T) : fallback;
}

function toonGradient(): DataTexture {
  // three light steps: shade, mid, lit
  const tex = new DataTexture(new Uint8Array([110, 190, 255]), 3, 1, RedFormat);
  tex.minFilter = NearestFilter;
  tex.magFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function outlineMaterial(): MeshBasicMaterial {
  const mat = new MeshBasicMaterial({ color: new Color(OUTLINE), side: BackSide });
  // Inverted hull: push the skinned vertices out along their (skinned) normal. The thin parts
  // that are already dark lines (glasses, eyes, beak, legs) point at the flat-colour swatch strip
  // (glTF v < SWATCH_V, see build_joud.py) and get no hull, so the wire frames stay thin.
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <skinning_vertex>',
      `#include <skinning_vertex>\n` +
        `transformed += normalize( objectNormal ) * ( uv.y < ${SWATCH_V.toFixed(3)} ? 0.0 : ${OUTLINE_WIDTH.toFixed(4)} );`,
    );
  };
  return mat;
}

/** Horizontal lines at the given heights, `halfWidth` to either side. */
function hLines(ys: number[], halfWidth: number, colour: string): LineSegments {
  const pts: number[] = [];
  for (const y of ys) pts.push(-halfWidth, y, 0, halfWidth, y, 0);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pts, 3));
  const lines = new LineSegments(geo, new LineBasicMaterial({ color: new Color(colour) }));
  lines.frustumCulled = false;
  return lines;
}

export async function startModelView(lane: GameBackdropCode): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const modelName = params.get('model') === 'v1' ? 'v1' : 'v2';
  let pose: Pose = pick(POSES, params.get('pose'), 'folded');
  let view: View = pick(VIEWS, params.get('view'), 'front');
  let look: Look = pick(LOOKS, params.get('look'), 'lambert');
  let showRef = params.get('ref') === '1';
  let ui = params.get('ui') !== '0';
  let showSockets = params.get('sockets') === '1';
  let blink = params.get('blink') === '1';
  let status = params.get('status') === '1';
  const tiltParam = Number(params.get('tilt') ?? PRESENT_TILT);
  let presentTilt = Number.isFinite(tiltParam) ? Math.max(0, Math.min(15, tiltParam)) : PRESENT_TILT;
  let bg: Background = pick(['plain', 'game', 'key'] as const, params.get('bg'), 'plain');
  let birdScale = lane.parseBirdScale(params.get('birdScale'));
  const gameTurn = modelName === 'v1' ? FACING_TURN : V2_TURN; // as the game draws this model
  let turn = clampTurn(Number(params.get('turn') ?? gameTurn), gameTurn);
  let laneY = clampLaneY(Number(params.get('laneY') ?? 0));
  let scroll = clampScroll(Number(params.get('scroll') ?? 0));
  let manual = false; // recordings: time moves only through api.step() and api.seek()
  let zoom = 1; // close-ups for screenshots: the camera's distance is divided by this
  let aim: [number, number, number] | null = null; // look at this point instead of the view's own

  // Take over the page: the game's frame stays hidden and never starts (see model-gate.ts).
  const gameFrame = document.getElementById('frame');
  if (gameFrame) gameFrame.style.display = 'none';
  document.body.style.background = BG;
  document.body.style.margin = '0';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;left:0;top:0;display:block;touch-action:none';
  document.body.appendChild(canvas);

  const refBox = document.createElement('figure');
  refBox.style.cssText =
    'position:fixed;top:0;right:0;margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
    'background:#fff;font:14px system-ui,sans-serif;color:#333;direction:ltr;box-sizing:border-box;padding:12px';
  const refImg = document.createElement('img');
  refImg.alt = 'official art';
  refImg.style.cssText = 'max-width:100%;max-height:calc(100% - 28px);object-fit:contain';
  const refCap = document.createElement('figcaption');
  refCap.style.cssText = 'margin-top:6px;text-align:center';
  refBox.append(refImg, refCap);
  document.body.appendChild(refBox);

  const overlay = document.createElement('pre');
  overlay.style.cssText =
    'position:fixed;left:8px;top:8px;margin:0;padding:6px 8px;font:12px/1.35 ui-monospace,monospace;' +
    'color:#1d2b22;background:rgba(255,255,255,.8);border-radius:6px;direction:ltr;text-align:left;' +
    'white-space:pre-wrap;max-width:calc(50% - 32px);pointer-events:none';
  document.body.appendChild(overlay);

  // One line saying what is playing, for recordings made without the controls.
  const caption = document.createElement('div');
  caption.style.cssText =
    'position:fixed;left:8px;bottom:8px;padding:3px 8px;font:600 14px/1.3 ui-monospace,monospace;color:#1d2b22;' +
    'background:rgba(255,255,255,.8);border-radius:6px;direction:ltr;pointer-events:none;white-space:pre';
  document.body.appendChild(caption);

  const bar = document.createElement('div');
  bar.style.cssText =
    'position:fixed;left:0;right:0;bottom:0;padding:8px;display:flex;flex-wrap:wrap;gap:6px;justify-content:center;' +
    'align-items:center;direction:ltr;background:rgba(255,255,255,.85);font:13px system-ui,sans-serif';
  document.body.appendChild(bar);

  let bytes = 0;
  const idleState: AnimState = { clip: '', time: 0, phase: 'ready', y: 0, vy: 0, tilt: 0, taps: 0, flapSpeed: 1, tapGap: 0 };
  const api: ModelApi = {
    ready: false,
    error: '',
    set: () => {},
    info: () => ({ model: modelName, pose, view, look, ref: showRef, calls: 0, triangles: 0, fps: 0, bytes, joints: [], sockets: [], clips: [], presentTilt: PRESENT_TILT, facingTurn: gameTurn, game: { bg, birdScale, turn, laneY, scroll } }),
    anim: () => idleState,
    tap: () => {},
    step: () => {},
    seek: () => {},
  };
  (window as unknown as { __joudModel?: ModelApi }).__joudModel = api;

  const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(new Color(BG));
  const scene = new Scene();
  // Same light colours and strengths as the game (view.ts). The sun follows the camera, except
  // in the game view, where it stands where the game's does.
  scene.add(new HemisphereLight('#ffffff', '#88aa77', 2.2));
  const sun = new DirectionalLight('#ffffff', 1.4);
  scene.add(sun, sun.target);
  const camera = new PerspectiveCamera(30, 1, 0.05, 50);
  const gameCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 50); // view.ts: straight-on, no perspective

  const file = modelName === 'v2' ? '../models/joud-v2.glb' : '../models/joud.glb';
  let root: Object3D;
  let skinned: SkinnedMesh | null = null;
  let lambert: MeshLambertMaterial;
  let toon: MeshToonMaterial;
  let outline: SkinnedMesh | null = null;
  let clipList: AnimationClip[] = [];
  const bones = new Map<string, Bone>();
  const sockets: Object3D[] = [];
  let extras: JoudExtras = {};
  try {
    const url = new URL(file, window.location.href).href;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    bytes = buf.byteLength;
    const gltf = await new GLTFLoader().parseAsync(buf, url);
    root = gltf.scene;
    clipList = gltf.animations;
    let mesh: Mesh | null = null;
    root.traverse((o) => {
      if (!mesh && (o as Mesh).isMesh) mesh = o as Mesh;
      if ((o as Bone).isBone) bones.set(o.name, o as Bone);
      if (o.name.startsWith('socket_')) sockets.push(o);
      const ex = (o.userData as { joud?: JoudExtras }).joud;
      if (ex) extras = ex;
    });
    if (!mesh) throw new Error(`no mesh in ${file}`);
    const m = mesh as Mesh;
    const src = m.material as MeshStandardMaterial;
    // As in the game (bird.ts): the GLB's PBR material becomes Lambert with the same map.
    lambert = new MeshLambertMaterial({ map: src.map ?? null, normalMap: src.normalMap ?? null });
    toon = new MeshToonMaterial({ map: (src.map as Texture | null) ?? null, gradientMap: toonGradient() });
    (src as Material).dispose();
    m.material = lambert;
    if ((m as SkinnedMesh).isSkinnedMesh) {
      skinned = m as SkinnedMesh;
      outline = new SkinnedMesh(skinned.geometry, outlineMaterial());
      outline.bind(skinned.skeleton, skinned.bindMatrix);
      outline.position.copy(skinned.position);
      outline.quaternion.copy(skinned.quaternion);
      outline.scale.copy(skinned.scale);
      outline.frustumCulled = false;
      skinned.parent?.add(outline);
    }
  } catch (err) {
    api.error = String((err as Error)?.message ?? err);
    overlay.textContent = `model failed: ${api.error}`;
    return;
  }
  // stage: where bird.ts's root is (height, tilt, squash); facing: bird.ts's turn to the left;
  // present: the wrapper above the root that leans the bird towards the camera (game view).
  const present = new Group();
  const stage = new Group();
  const facing = new Group();
  facing.add(root);
  stage.add(facing);
  present.add(stage);
  scene.add(present);
  const axes = sockets.map((s) => {
    const a = new AxesHelper(0.14);
    s.add(a);
    return a;
  });
  // Game view, tap demo: guide lines that show the bird's rise and fall, and the lane's floor and roof.
  const laneHalf = GAME.laneH / 2 / MODEL_UNIT;
  const ruler = hLines(Array.from({ length: 9 }, (_v, i) => (i - 4) * RULER_STEP), 40, '#d3dbe6');
  const bounds = hLines([-laneHalf, laneHalf], 40, '#248F59');
  ruler.position.z = bounds.position.z = -5;
  scene.add(ruler, bounds);
  // &bg=game: the game's own backdrop (game-backdrop.ts, in lane units), scaled to model units and
  // placed so that the bird, at model x 0, is at the game's birdX. The lane's centre is y 0 in both.
  const backdrop = new Group();
  const backdropParts = lane.addGameBackdrop(backdrop, GAME.laneH, true);
  lane.scrollBackdrop(backdropParts, scroll);
  backdrop.scale.setScalar(1 / MODEL_UNIT);
  backdrop.position.x = -GAME.birdX / MODEL_UNIT;
  scene.add(backdrop);
  const plainColour = new Color(BG);
  const gameColour = lane.gameBackground();
  const keyColour = new Color(KEY);

  // --- still poses -------------------------------------------------------------------------------
  const bind = new Map<string, { p: Vector3; q: Quaternion; s: Vector3 }>();
  for (const [n, b] of bones) bind.set(n, { p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() });
  const folded = extras.poses?.rest_folded ?? {};
  const foldedScale = extras.poses_scale?.rest_folded ?? {};
  function resetBind(): void {
    for (const [n, b] of bones) {
      const r = bind.get(n)!;
      b.position.copy(r.p);
      b.quaternion.copy(r.q);
      b.scale.copy(r.s);
    }
  }
  function applyStill(t: number): void {
    if (pose === 'folded') {
      for (const [n, b] of bones) {
        if (folded[n]) b.quaternion.fromArray(folded[n]);
        if (foldedScale[n]) b.scale.fromArray(foldedScale[n]);
      }
    }
    const eye = extras.blink ? bones.get(extras.blink.bone) : undefined;
    if (eye && extras.blink) {
      // blink every 2.6 s for 0.16 s
      const closed = blink && t % 2.6 < 0.16;
      eye.scale.set(1, 1, 1);
      eye.scale[extras.blink.local_axis] = closed ? extras.blink.closed_scale : 1;
    }
  }

  // --- clips (joud-clips.ts: the same cross-fades as the game's ?model=v2 bird) ----------------------
  const mixer = new AnimationMixer(root);
  const clips = new JoudClips(mixer, clipList, (c) => extras.clips?.[c]?.loop);
  const { actions, loops } = clips;
  const hasClips = clips.complete;
  if (!hasClips && !STILLS.includes(pose as (typeof STILLS)[number])) pose = 'folded';
  let hold = 0; // seconds a finished one-shot has been held (single clips replay after REPLAY_AFTER)
  const fadeTo = (clip: Clip, seconds: number, speed = 1): void => {
    clips.fadeTo(clip, seconds, speed);
    hold = 0;
  };

  // --- the tap demo -----------------------------------------------------------------------------------
  const body: Body = { y: 0, vy: 0 };
  let phase: AnimState['phase'] = 'ready';
  let clock = 0; // seconds since the page started (the manual clock when recording)
  let acc = 0; // time not yet simulated (the game's fixed step)
  let squash = 0;
  let overAt = 0;
  let taps = 0;
  let speed = 1;
  let tapGap = 0;
  let tapFlash = 0; // seconds the caption still shows the tap mark
  let camY = 0; // the game view's camera follows the bird softly

  function resetDemo(): void {
    body.y = 0;
    body.vy = 0;
    phase = 'ready';
    acc = 0;
    squash = 0;
    taps = 0;
    speed = 1;
    tapGap = 0;
    camY = 0;
    clips.ready();
    hold = 0;
  }

  function tap(): void {
    if (pose !== 'tap' || !hasClips) return;
    if (phase === 'over') {
      // as the game does: no restart while the crash still plays, then back to "ready"
      if (clock - overAt >= GAME.restartLockout) resetDemo();
      return;
    }
    ({ gap: tapGap, speed } = clips.tap(clock, phase !== 'playing'));
    taps++;
    phase = 'playing';
    coreFlap(body, GAME);
    squash = 1;
    tapFlash = 0.14;
    hold = 0;
  }

  function stepDemo(dt: number): void {
    squash = Math.max(0, squash - dt * SQUASH.fade);
    if (phase !== 'playing') return;
    acc += dt;
    while (acc >= GAME.step && phase === 'playing') {
      acc -= GAME.step;
      integrate(body, GAME.step, GAME);
      const half = GAME.laneH / 2;
      if (body.y - GAME.birdRadius <= -half || body.y + GAME.birdRadius >= half) {
        phase = 'over';
        overAt = clock;
        clips.crash();
      }
    }
    if (phase === 'playing') clips.follow(body.vy, FALL_VY);
  }

  /** A single clip: a one-shot is held on its last frame for a moment, then played again. */
  function stepSingle(dt: number): void {
    const lead = clips.lead;
    if (!lead || !clips.leadDone()) return;
    hold += dt;
    if (hold >= REPLAY_AFTER[lead.clip]) fadeTo(lead.clip, 0);
  }

  function startPose(): void {
    clips.stop();
    hold = 0;
    resetBind(); // a clip's resting channels blend towards what the bones hold when it starts
    stage.position.set(0, 0, 0);
    stage.rotation.set(0, 0, 0);
    stage.scale.set(1, 1, 1);
    if (!hasClips && !STILLS.includes(pose as (typeof STILLS)[number])) pose = 'folded';
    if (pose === 'tap') resetDemo();
    else if (isClip(pose)) fadeTo(pose, 0);
  }

  /** The root's place, as bird.ts sets it; only the game view shows it. */
  function tiltNow(): number {
    if (view !== 'game') return 0;
    if (pose === 'tap') return phase === 'playing' ? Math.max(-1, Math.min(1, body.vy / GAME.flapVelocity)) : 0;
    return pose === 'fall' ? -1 : 0; // the game only shows fall while the bird drops, nose down
  }
  function placeStage(dt: number): void {
    const inGame = view === 'game';
    const demo = inGame && pose === 'tap';
    facing.rotation.y = inGame ? turn * DEG : 0;
    facing.scale.setScalar(inGame ? birdScale : 1); // as view.ts's birdHolder: the drawn bird only
    const s = demo ? squash : 0;
    stage.position.y = demo ? body.y / MODEL_UNIT : inGame ? laneY / MODEL_UNIT : 0;
    stage.rotation.z = -tiltNow() * TILT_MAX * DEG; // facing left: nose up is a clockwise turn
    stage.scale.set(1 + SQUASH.wide * s, 1 - SQUASH.flat * s, 1 + SQUASH.wide * s);
    // lean towards the camera about the root's own place: the root stays where the game put it
    const lean = inGame ? presentTilt * DEG : 0;
    const y = stage.position.y;
    present.rotation.x = lean;
    present.position.set(0, y - y * Math.cos(lean), -y * Math.sin(lean));
    camY += (stage.position.y - camY) * (1 - Math.exp(-dt / 0.09));
    if (!demo) camY = stage.position.y;
    ruler.visible = bounds.visible = demo && bg === 'plain';
    ruler.position.y = Math.round(camY / RULER_STEP) * RULER_STEP;
  }

  function advance(dt: number): void {
    clock += dt;
    tapFlash = Math.max(0, tapFlash - dt);
    if (clips.lead) {
      if (pose === 'tap') stepDemo(dt);
      else stepSingle(dt);
      clips.update(dt);
    } else {
      applyStill(clock);
    }
    placeStage(dt);
  }

  function applyLook(): void {
    if (!skinned) return;
    skinned.material = look === 'toon' ? toon : lambert;
    if (outline) outline.visible = look === 'toon';
  }

  const camPos = new Vector3();
  const target = new Vector3();
  function applyView(): void {
    const framed = view === 'game' && bg !== 'plain'; // the game camera's fixed frame
    backdrop.visible = view === 'game' && bg === 'game';
    renderer.setClearColor(!framed ? plainColour : bg === 'game' ? gameColour : keyColour);
    if (view === 'game') {
      // view.ts: the camera looks straight down -Z, and the sun stands up and to the left
      gameCamera.rotation.set(0, 0, 0);
      sun.position.set(-1, 2, 3);
      sun.target.position.set(0, 0, 0);
      if (!framed) {
        gameCamera.position.set(0, camY + 0.2, 10);
        return;
      }
      // The game camera's fixed frame (view.ts), in model units; a zoom above 1 closes in on the bird.
      const f = lane.laneFrame(GAME.laneW, GAME.laneH, canvasW, canvasH);
      const k = 1 / zoom;
      gameCamera.position.set((-GAME.birdX / MODEL_UNIT) * k, (f.cy / MODEL_UNIT) * k + stage.position.y * (1 - k), 10);
      gameCamera.right = (f.halfW / MODEL_UNIT) * k;
      gameCamera.left = -gameCamera.right;
      gameCamera.top = (f.halfH / MODEL_UNIT) * k;
      gameCamera.bottom = -gameCamera.top;
      gameCamera.updateProjectionMatrix();
      return;
    }
    const c = cameraFor(view, pose);
    camPos.set(Math.sin(c.az * DEG) * Math.cos(c.el * DEG), Math.sin(c.el * DEG), Math.cos(c.az * DEG) * Math.cos(c.el * DEG));
    if (aim) target.fromArray(aim);
    else target.set(0, c.y, 0);
    camera.position.copy(target).addScaledVector(camPos, c.dist / zoom);
    camera.lookAt(target);
    sun.position.copy(camera.position).add(camPos.set(-1, 2, 0));
    sun.target.position.copy(target);
  }

  // --- layout and controls ------------------------------------------------------------------------
  let canvasW = 1;
  let canvasH = 1;
  function layout(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const cw = showRef ? Math.floor(w / 2) : w;
    canvasW = cw;
    canvasH = h;
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${h}px`;
    renderer.setSize(cw, h, false);
    camera.aspect = cw / h;
    camera.updateProjectionMatrix();
    const halfH = GAME_HALF_HEIGHT / zoom;
    gameCamera.top = halfH;
    gameCamera.bottom = -halfH;
    gameCamera.right = (halfH * cw) / h;
    gameCamera.left = -gameCamera.right;
    gameCamera.updateProjectionMatrix();
    const r = referenceFor(view, pose);
    refBox.style.display = showRef ? 'flex' : 'none';
    refBox.style.width = `${w - cw}px`;
    refBox.style.height = `${h - (ui ? bar.offsetHeight : 0)}px`;
    caption.style.bottom = `${(ui ? bar.offsetHeight : 0) + 8}px`;
    if (r) {
      refImg.style.display = '';
      if (!refImg.src.endsWith(r.src)) refImg.src = r.src;
      refCap.textContent = r.caption;
    } else {
      refImg.style.display = 'none';
      refImg.removeAttribute('src');
      refCap.textContent =
        view === 'top'
          ? 'From above, Joud’s front towards the bottom: the green edge leads on both wings. (No view from above in the official art.)'
          : 'No back view in the official art: the plain back and the collar going round are assumptions, for Joud’s approval.';
    }
  }

  const buttons: { el: HTMLButtonElement; on: () => boolean }[] = [];
  function button(label: string, on: () => boolean, click: () => void, press = false): HTMLButtonElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = label;
    el.style.cssText = 'padding:6px 10px;border:1px solid #888;border-radius:6px;background:#fff;color:#111;touch-action:manipulation';
    // `press`: act on the press itself, so quick taps on a phone are not lost or delayed
    el.addEventListener(press ? 'pointerdown' : 'click', (e) => {
      if (press) e.preventDefault();
      click();
      refresh();
    });
    buttons.push({ el, on });
    bar.appendChild(el);
    return el;
  }
  function gap(): void {
    const el = document.createElement('span');
    el.style.cssText = 'width:10px';
    bar.appendChild(el);
  }
  const choose = (p: Pose): void => {
    pose = p;
    startPose();
  };
  for (const p of STILLS) button(p, () => pose === p, () => choose(p));
  if (hasClips) {
    gap();
    for (const c of CLIPS) button(c, () => pose === c, () => choose(c));
    const tapButton = button('tap', () => pose === 'tap', () => {
      if (pose !== 'tap') choose('tap');
      tap();
    }, true);
    tapButton.style.padding = '10px 22px';
    tapButton.style.fontWeight = '700';
    tapButton.title = 'Each press is one tap. Press quickly: a tap during flap restarts it, and taps under 0.3 s apart play it faster. Space and a tap on the picture do the same.';
  }
  gap();
  for (const v of VIEWS) button(v === 'game' ? 'game view' : v, () => view === v, () => (view = v));
  button(`tilt ${PRESENT_TILT}°`, () => presentTilt > 0, () => (presentTilt = presentTilt > 0 ? 0 : PRESENT_TILT)).title =
    'Game view only: lean the bird towards the camera so the top of the wings shows.';
  button('game sky', () => bg === 'game', () => (bg = bg === 'game' ? 'plain' : 'game')).title =
    "Game view only: the game's own sky, plaza and ground, and the game camera's frame.";
  const sizeButton = button('', () => birdScale !== 1, () => (birdScale = cycle(SIZES, birdScale)));
  sizeButton.title = 'Game view only: size of the drawn bird (the hitbox does not change).';
  const turnButton = button('', () => turn !== gameTurn, () => (turn = cycle(TURNS, turn)));
  turnButton.title = `Game view only: the bird's turn about Y (the game draws ${modelName} at ${gameTurn}°).`;
  gap();
  for (const l of LOOKS) button(l, () => look === l, () => (look = l));
  button('official art', () => showRef, () => (showRef = !showRef));
  button('sockets', () => showSockets, () => (showSockets = !showSockets));
  button('blink', () => blink, () => (blink = !blink));
  canvas.addEventListener('pointerdown', () => tap());
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.repeat && pose === 'tap') {
      e.preventDefault();
      tap();
    }
  });

  function refresh(): void {
    sizeButton.textContent = `size ${birdScale}`;
    turnButton.textContent = `turn ${turn}°`;
    for (const b of buttons) {
      const on = b.on();
      b.el.style.background = on ? '#248F59' : '#fff';
      b.el.style.color = on ? '#fff' : '#111';
    }
    bar.style.display = ui ? 'flex' : 'none';
    overlay.style.display = ui ? 'block' : 'none';
    for (const a of axes) a.visible = showSockets;
    applyLook();
    layout();
  }

  let calls = 0;
  let triangles = 0;
  let fps = 0;
  let frames = 0;
  let fpsStart = performance.now();
  let overlayAt = 0;
  const joints = skinned ? skinned.skeleton.bones.map((b) => b.name) : [];
  const clipInfo = CLIPS.filter((c) => actions.has(c)).map((c) => ({
    name: c as string,
    duration: actions.get(c)!.getClip().duration,
    loop: loops.get(c) ?? false,
  }));
  const animState = (): AnimState => ({
    clip: clips.lead ? clips.lead.clip : '',
    time: clips.lead ? clips.lead.action.time : 0,
    phase,
    y: body.y / MODEL_UNIT,
    vy: body.vy,
    tilt: tiltNow() * TILT_MAX,
    taps,
    flapSpeed: speed,
    tapGap,
  });

  function draw(now: number): void {
    applyView();
    renderer.render(scene, view === 'game' ? gameCamera : camera);
    calls = renderer.info.render.calls;
    triangles = renderer.info.render.triangles;
    const lead = clips.lead;
    const playing = lead ? `${lead.clip}${lead.clip === 'flap' && speed > 1 && pose === 'tap' ? ` x${speed.toFixed(2)}` : ''}` : pose;
    caption.style.display = status ? 'block' : 'none';
    if (status) caption.textContent = `${tapFlash > 0 ? '● tap  ' : ''}${playing}`;
    if (ui && (manual || now - overlayAt > 120)) {
      overlayAt = now;
      const a = animState();
      const demo =
        pose === 'tap'
          ? `\ntap demo (${a.phase}): taps ${a.taps}  flap speed ${a.flapSpeed.toFixed(2)}x` +
            `${a.tapGap > 0 ? ` (${a.tapGap.toFixed(2)} s after the tap before)` : ''}\n` +
            `height ${a.y.toFixed(1)}  vy ${a.vy.toFixed(2)}  root tilt ${a.tilt.toFixed(0)} deg${view === 'game' ? '' : ' (height and tilt show in the game view)'}`
          : '';
      overlay.textContent =
        `Joud ${modelName}  ${(bytes / 1024).toFixed(0)} KB  fps ${fps}  draw calls ${calls}  tris ${triangles}\n` +
        `pose ${pose}  view ${view}${view === 'game' ? ` (leaning ${presentTilt} deg towards the camera, turned ${turn} deg, size ${birdScale}${bg === 'plain' ? '' : `, ${bg === 'game' ? 'game sky' : 'key'}`})` : ''}  look ${look}${look === 'toon' ? ' (proposal, not allowed by CLAUDE.md yet)' : ''}\n` +
        `bones ${joints.length}  sockets ${sockets.map((s) => s.name.replace('socket_', '')).join(', ')}` +
        (lead ? `\nclip ${playing}  ${a.time.toFixed(2)} / ${lead.action.getClip().duration.toFixed(2)} s` : '') +
        demo;
    }
  }

  api.set = (o) => {
    if (o.view) view = o.view;
    if (o.look) look = o.look;
    if (o.ref !== undefined) showRef = o.ref;
    if (o.ui !== undefined) ui = o.ui;
    if (o.sockets !== undefined) showSockets = o.sockets;
    if (o.blink !== undefined) blink = o.blink;
    if (o.zoom !== undefined) zoom = o.zoom;
    if (o.aim !== undefined) aim = o.aim;
    if (o.manual !== undefined) manual = o.manual;
    if (o.status !== undefined) status = o.status;
    if (o.tilt !== undefined) presentTilt = Math.max(0, Math.min(15, o.tilt));
    if (o.bg) bg = o.bg;
    if (o.birdScale !== undefined) birdScale = lane.parseBirdScale(String(o.birdScale));
    if (o.turn !== undefined) turn = clampTurn(o.turn, gameTurn);
    if (o.laneY !== undefined) laneY = clampLaneY(o.laneY);
    if (o.scroll !== undefined) {
      scroll = clampScroll(o.scroll);
      lane.scrollBackdrop(backdropParts, scroll);
    }
    if (o.pose) choose(o.pose);
    refresh();
    if (manual) {
      advance(0);
      draw(performance.now());
    }
  };
  api.info = () => ({
    model: modelName,
    pose,
    view,
    look,
    ref: showRef,
    calls,
    triangles,
    fps,
    bytes,
    joints,
    sockets: sockets.map((s) => s.name),
    clips: clipInfo,
    presentTilt: PRESENT_TILT,
    facingTurn: gameTurn,
    game: { bg, birdScale, turn, laneY, scroll },
  });
  api.anim = animState;
  api.tap = tap;
  api.step = (dt) => {
    advance(dt);
    draw(performance.now());
  };
  api.seek = (time) => {
    const lead = clips.lead;
    if (!lead || pose === 'tap') return;
    clips.stepFade(Number.POSITIVE_INFINITY);
    hold = 0;
    lead.action.time = Math.max(0, Math.min(time, lead.action.getClip().duration));
    mixer.update(0);
    placeStage(0);
    draw(performance.now());
  };
  window.addEventListener('resize', layout);
  startPose();
  refresh();

  let last = 0;
  function frame(now: number): void {
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    if (!manual) {
      advance(dt);
      draw(now);
      frames++;
    }
    if (now - fpsStart >= 1000) {
      fps = Math.round((frames * 1000) / (now - fpsStart));
      frames = 0;
      fpsStart = now;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  api.ready = true;
}
