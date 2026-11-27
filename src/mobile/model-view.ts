// ?debug=1&rig=1&model=v2: Joud's v2 model (public/models/joud-v2.glb, built by
// tools/blender/build_joud.py) on a plain background, next to the official art.
// Loaded by model-gate.ts through a dynamic import(), so it is its own chunk and the game's
// first load doesn't change. Developer-only page: its labels are English, not strings.ts.
//
// URL: &model=v2|v1  &pose=folded|spread|flap  &view=front|three-quarter|side|back
//      &ref=1 (the matching official art beside the model)  &look=lambert|toon
//      &sockets=1 (show the customization sockets)  &blink=1  &ui=0 (no controls, for shots)
// Screenshot scripts drive it through window.__joudModel (scripts/model-shots.ts).

import {
  AxesHelper,
  BackSide,
  type Bone,
  Color,
  DataTexture,
  DirectionalLight,
  HemisphereLight,
  type Material,
  type Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type MeshStandardMaterial,
  MeshToonMaterial,
  NearestFilter,
  type Object3D,
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

export const POSES = ['folded', 'spread', 'flap'] as const;
export const VIEWS = ['front', 'three-quarter', 'side', 'back', 'face'] as const;
export const LOOKS = ['lambert', 'toon'] as const;
export type Pose = (typeof POSES)[number];
export type View = (typeof VIEWS)[number];
export type Look = (typeof LOOKS)[number];

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
}

export interface ModelApi {
  ready: boolean;
  error: string;
  set(o: { pose?: Pose; view?: View; look?: Look; ref?: boolean; ui?: boolean; sockets?: boolean; blink?: boolean }): void;
  info(): ModelInfo;
}

interface JoudExtras {
  poses?: Record<string, Record<string, number[]>>;
  blink?: { bone: string; local_axis: 'x' | 'y' | 'z'; closed_scale: number };
  sockets?: Record<string, string>;
}

const DEG = Math.PI / 180;
const BG = '#e9eef5';
const OUTLINE = '#3b2a20';
const OUTLINE_WIDTH = 0.011; // model units (the game draws Joud at 0.2 scale)
const SWATCH_V = 0.035; // build_joud.py: 1 - ATLAS_FIT

/** The official art that matches each view and pose, with a caption. */
function referenceFor(view: View, pose: Pose): { src: string; caption: string } | null {
  if (view === 'back') return null;
  if (view === 'side') return { src: refSide, caption: 'Slim outfit, side (compare silhouette, legs, tail)' };
  if ((view === 'front' && pose === 'folded') || view === 'face') return { src: refFront, caption: 'Round outfit, front (wings down)' };
  return { src: refPoster, caption: 'Flying poster (wings spread)' };
}

/** Camera azimuth (about Y, from +Z = front; +90 = Joud's left side), elevation, distance. */
function cameraFor(view: View, pose: Pose): { az: number; el: number; dist: number; y: number } {
  const wide = pose !== 'folded';
  const dist = wide ? 8.2 : 4.6; // spread: the wings span about 3.6
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
  }
}

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

export async function startModelView(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const modelName = params.get('model') === 'v1' ? 'v1' : 'v2';
  let pose: Pose = pick(POSES, params.get('pose'), 'folded');
  let view: View = pick(VIEWS, params.get('view'), 'front');
  let look: Look = pick(LOOKS, params.get('look'), 'lambert');
  let showRef = params.get('ref') === '1';
  let ui = params.get('ui') !== '0';
  let showSockets = params.get('sockets') === '1';
  let blink = params.get('blink') === '1';

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

  const bar = document.createElement('div');
  bar.style.cssText =
    'position:fixed;left:0;right:0;bottom:0;padding:8px;display:flex;flex-wrap:wrap;gap:6px;justify-content:center;' +
    'direction:ltr;background:rgba(255,255,255,.85);font:13px system-ui,sans-serif';
  document.body.appendChild(bar);

  let bytes = 0;
  const api: ModelApi = {
    ready: false,
    error: '',
    set: () => {},
    info: () => ({ model: modelName, pose, view, look, ref: showRef, calls: 0, triangles: 0, fps: 0, bytes, joints: [], sockets: [] }),
  };
  (window as unknown as { __joudModel?: ModelApi }).__joudModel = api;

  const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(new Color(BG));
  const scene = new Scene();
  // Same light colours and strengths as the game (view.ts); the sun follows the camera.
  scene.add(new HemisphereLight('#ffffff', '#88aa77', 2.2));
  const sun = new DirectionalLight('#ffffff', 1.4);
  scene.add(sun, sun.target);
  const camera = new PerspectiveCamera(30, 1, 0.05, 50);

  const file = modelName === 'v2' ? '../models/joud-v2.glb' : '../models/joud.glb';
  let root: Object3D;
  let skinned: SkinnedMesh | null = null;
  let lambert: MeshLambertMaterial;
  let toon: MeshToonMaterial;
  let outline: SkinnedMesh | null = null;
  const bones = new Map<string, Bone>();
  const bind = new Map<string, Quaternion>();
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
    let mesh: Mesh | null = null;
    root.traverse((o) => {
      if (!mesh && (o as Mesh).isMesh) mesh = o as Mesh;
      if ((o as Bone).isBone) {
        bones.set(o.name, o as Bone);
        bind.set(o.name, o.quaternion.clone());
      }
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
  scene.add(root);
  const axes = sockets.map((s) => {
    const a = new AxesHelper(0.14);
    s.add(a);
    return a;
  });

  // --- poses -------------------------------------------------------------------------------------
  const folded = extras.poses?.rest_folded ?? {};
  const wingNames = [...bones.keys()].filter((n) => n.startsWith('wing_'));
  // Each wing bone's axis for flapping: the model's front-back axis (+Z) in the bone's frame
  // at the bind pose, so the wing turns within its own plane.
  const flapAxis = new Map<string, Vector3>();
  root.updateMatrixWorld(true);
  const wq = new Quaternion();
  for (const n of wingNames) {
    bones.get(n)!.getWorldQuaternion(wq);
    flapAxis.set(n, new Vector3(0, 0, 1).applyQuaternion(wq.invert()));
  }
  const tmpQ = new Quaternion();
  function applyPose(t: number): void {
    for (const n of wingNames) {
      const b = bones.get(n)!;
      if (pose === 'folded' && folded[n]) {
        b.quaternion.fromArray(folded[n]);
      } else if (pose === 'flap') {
        // a full beat at 2.5 beats/s: +55 degrees up to -45 down; the mid and tip lag and curl
        const side = n.endsWith('_L') ? 1 : -1;
        const phase = n.startsWith('wing_shoulder') ? 0 : n.startsWith('wing_mid') ? 0.5 : 0.9;
        const amp = n.startsWith('wing_shoulder') ? 50 : n.startsWith('wing_mid') ? 14 : 10;
        const a = (amp * Math.sin(t * 2.5 * 2 * Math.PI - phase) + (n.startsWith('wing_shoulder') ? 5 : 0)) * DEG;
        tmpQ.setFromAxisAngle(flapAxis.get(n)!, side * a);
        b.quaternion.copy(bind.get(n)!).multiply(tmpQ);
      } else {
        b.quaternion.copy(bind.get(n)!);
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

  function applyLook(): void {
    if (!skinned) return;
    skinned.material = look === 'toon' ? toon : lambert;
    if (outline) outline.visible = look === 'toon';
  }

  const camPos = new Vector3();
  const target = new Vector3();
  function applyView(): void {
    const c = cameraFor(view, pose);
    camPos.set(Math.sin(c.az * DEG) * Math.cos(c.el * DEG), Math.sin(c.el * DEG), Math.cos(c.az * DEG) * Math.cos(c.el * DEG));
    target.set(0, c.y, 0);
    camera.position.copy(target).addScaledVector(camPos, c.dist);
    camera.lookAt(target);
    sun.position.copy(camera.position).add(camPos.set(-1, 2, 0));
    sun.target.position.copy(target);
  }

  // --- layout and controls ------------------------------------------------------------------------
  function layout(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const cw = showRef ? Math.floor(w / 2) : w;
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${h}px`;
    renderer.setSize(cw, h, false);
    camera.aspect = cw / h;
    camera.updateProjectionMatrix();
    const r = referenceFor(view, pose);
    refBox.style.display = showRef ? 'flex' : 'none';
    refBox.style.width = `${w - cw}px`;
    refBox.style.height = `${h - (ui ? bar.offsetHeight : 0)}px`;
    if (r) {
      refImg.style.display = '';
      if (!refImg.src.endsWith(r.src)) refImg.src = r.src;
      refCap.textContent = r.caption;
    } else {
      refImg.style.display = 'none';
      refImg.removeAttribute('src');
      refCap.textContent = 'No back view in the official art: the plain back and the collar going round are assumptions, for Joud’s approval.';
    }
  }

  const buttons: { el: HTMLButtonElement; on: () => boolean }[] = [];
  function button(label: string, on: () => boolean, click: () => void): void {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = label;
    el.style.cssText = 'padding:6px 10px;border:1px solid #888;border-radius:6px;background:#fff;color:#111';
    el.addEventListener('click', () => {
      click();
      refresh();
    });
    buttons.push({ el, on });
    bar.appendChild(el);
  }
  for (const p of POSES) button(p, () => pose === p, () => (pose = p));
  for (const v of VIEWS) button(v, () => view === v, () => (view = v));
  for (const l of LOOKS) button(l, () => look === l, () => (look = l));
  button('official art', () => showRef, () => (showRef = !showRef));
  button('sockets', () => showSockets, () => (showSockets = !showSockets));
  button('blink', () => blink, () => (blink = !blink));

  function refresh(): void {
    for (const b of buttons) {
      const on = b.on();
      b.el.style.background = on ? '#248F59' : '#fff';
      b.el.style.color = on ? '#fff' : '#111';
    }
    bar.style.display = ui ? 'flex' : 'none';
    overlay.style.display = ui ? 'block' : 'none';
    for (const a of axes) a.visible = showSockets;
    applyLook();
    applyView();
    layout();
  }

  api.set = (o) => {
    if (o.pose) pose = o.pose;
    if (o.view) view = o.view;
    if (o.look) look = o.look;
    if (o.ref !== undefined) showRef = o.ref;
    if (o.ui !== undefined) ui = o.ui;
    if (o.sockets !== undefined) showSockets = o.sockets;
    if (o.blink !== undefined) blink = o.blink;
    refresh();
  };
  window.addEventListener('resize', layout);
  refresh();

  let calls = 0;
  let triangles = 0;
  let fps = 0;
  let frames = 0;
  let fpsStart = performance.now();
  let overlayAt = 0;
  const joints = skinned ? skinned.skeleton.bones.map((b) => b.name) : [];
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
  });

  function frame(now: number): void {
    applyPose(now / 1000);
    renderer.render(scene, camera);
    calls = renderer.info.render.calls;
    triangles = renderer.info.render.triangles;
    frames++;
    if (now - fpsStart >= 1000) {
      fps = Math.round((frames * 1000) / (now - fpsStart));
      frames = 0;
      fpsStart = now;
    }
    if (ui && now - overlayAt > 250) {
      overlayAt = now;
      overlay.textContent =
        `Joud ${modelName}  ${(bytes / 1024).toFixed(0)} KB  fps ${fps}  draw calls ${calls}  tris ${triangles}\n` +
        `pose ${pose}  view ${view}  look ${look}${look === 'toon' ? ' (proposal, not allowed by CLAUDE.md yet)' : ''}\n` +
        `bones ${joints.length}  sockets ${sockets.map((s) => s.name.replace('socket_', '')).join(', ')}`;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  api.ready = true;
}
