// ?debug=1&rig=1: Joud's rig prototype on a plain background (feat/joud-rig-spike).
// Loaded by main.ts through a dynamic import(), so it is its own chunk and the game's
// first load doesn't change. Developer-only page: its labels are English, not strings.ts.
//
// URL: &pose=folded|-60|-30|0|30|60|beat  &view=front|three-quarter|side|back|shoulder-l|shoulder-r
//      &blend=narrow|wide  &ui=0 (hide controls and overlay, for screenshots)
// Screenshot scripts drive it through window.__joudRig (scripts/rig-shots.ts).

import {
  Color,
  DirectionalLight,
  HemisphereLight,
  type Material,
  type Mesh,
  MeshLambertMaterial,
  type MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildExtrasGeometry } from '../scene/bird';
import { BirdRig } from '../scene/bird-rig';
import { describeRig, SHOULDER_BLEND, SHOULDER_BLEND_WIDE } from '../scene/rig-weights';

export const POSES = ['folded', '-60', '-30', '0', '30', '60', 'beat'] as const;
export const VIEWS = ['front', 'three-quarter', 'side', 'back', 'shoulder-l', 'shoulder-r'] as const;
export const BLENDS = { narrow: SHOULDER_BLEND, wide: SHOULDER_BLEND_WIDE } as const;
export type Pose = (typeof POSES)[number];
export type View = (typeof VIEWS)[number];
export type BlendName = keyof typeof BLENDS;

export interface RigApi {
  ready: boolean;
  error: string;
  set(o: { pose?: Pose; view?: View; blend?: BlendName; ui?: boolean }): void;
  info(): { calls: number; triangles: number; fps: number; rig: string; pose: Pose; view: View; blend: BlendName };
  /** Try another folded pose (degrees), e.g. from the console while tuning. */
  setFold(downDeg: number, backDeg: number, rollDeg: number): void;
  /** Move the wings' downward hinge from the measured shoulder point (debug tuning). */
  setHinge(dx: number, dy: number): void;
  /** Wing vertices that the current pose pushes inside the body, and the deepest one. */
  penetration(): { vertices: number; deepest: number };
}

const DEG = Math.PI / 180;
const BG = '#e9eef5';

/** Camera azimuth (about Y, from +Z = front; +90 = Joud's left side), elevation, distance. */
function cameraFor(view: View, shoulderX: number, wingY: number): { az: number; el: number; dist: number; target: Vector3 } {
  const centre = new Vector3(0, 0, 0);
  switch (view) {
    case 'front':
      return { az: 0, el: 6, dist: 4.2, target: centre };
    // The game turns Joud −55° about Y, which shows its left side and front.
    case 'three-quarter':
      return { az: 55, el: 6, dist: 4.2, target: centre };
    case 'side':
      return { az: 90, el: 6, dist: 4.2, target: centre };
    case 'back':
      return { az: 180, el: 6, dist: 4.2, target: centre };
    case 'shoulder-l':
      return { az: 35, el: 12, dist: 1.9, target: new Vector3(shoulderX, wingY - 0.05, 0) };
    case 'shoulder-r':
      return { az: -35, el: 12, dist: 1.9, target: new Vector3(-shoulderX, wingY - 0.05, 0) };
  }
}

function pick<T extends string>(list: readonly T[], v: string | null, fallback: T): T {
  return list.includes(v as T) ? (v as T) : fallback;
}

export async function startRigView(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  let pose: Pose = pick(POSES, params.get('pose'), 'folded');
  let view: View = pick(VIEWS, params.get('view'), 'front');
  let blend: BlendName = params.get('blend') === 'wide' ? 'wide' : 'narrow';
  let ui = params.get('ui') !== '0';

  // Take over the page: the game's frame stays hidden and never starts (see main.ts).
  const gameFrame = document.getElementById('frame');
  if (gameFrame) gameFrame.style.display = 'none';
  document.body.style.background = BG;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;touch-action:none';
  document.body.appendChild(canvas);

  const overlay = document.createElement('pre');
  overlay.style.cssText =
    'position:fixed;left:8px;top:8px;margin:0;padding:6px 8px;font:12px/1.35 ui-monospace,monospace;' +
    'color:#1d2b22;background:rgba(255,255,255,.8);border-radius:6px;direction:ltr;text-align:left;' +
    'white-space:pre-wrap;max-width:calc(100% - 32px);pointer-events:none';
  document.body.appendChild(overlay);

  const bar = document.createElement('div');
  bar.style.cssText =
    'position:fixed;left:0;right:0;bottom:0;padding:8px;display:flex;flex-wrap:wrap;gap:6px;justify-content:center;' +
    'direction:ltr;background:rgba(255,255,255,.85);font:13px system-ui,sans-serif';
  document.body.appendChild(bar);

  const api: RigApi = {
    ready: false,
    error: '',
    set: () => {},
    info: () => ({ calls: 0, triangles: 0, fps: 0, rig: '', pose, view, blend }),
    penetration: () => ({ vertices: 0, deepest: 0 }),
    setFold: () => {},
    setHinge: () => {},
  };
  (window as unknown as { __joudRig?: RigApi }).__joudRig = api;

  const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(new Color(BG));
  const scene = new Scene();
  // Same light colours and strengths as the game (view.ts). The sun follows the camera
  // here so the back and the shoulders are lit from every view.
  scene.add(new HemisphereLight('#ffffff', '#88aa77', 2.2));
  const sun = new DirectionalLight('#ffffff', 1.4);
  scene.add(sun, sun.target);
  const camera = new PerspectiveCamera(30, 1, 0.05, 50);

  let rig: BirdRig;
  try {
    // Same URL as the game (main.ts): play/ sits one level below the site root.
    const gltf = await new GLTFLoader().loadAsync(new URL('../models/joud.glb', window.location.href).href);
    let mesh: Mesh | null = null;
    gltf.scene.traverse((o) => {
      if (!mesh && (o as Mesh).isMesh) mesh = o as Mesh;
    });
    if (!mesh) throw new Error('no mesh in joud.glb');
    const src = (mesh as Mesh).material as MeshStandardMaterial;
    // As in bird.ts: the GLB's PBR material becomes Lambert with the same maps.
    const mat = new MeshLambertMaterial({ map: src.map ?? null, normalMap: src.normalMap ?? null, color: src.color });
    if (src.normalMap) mat.normalScale.copy(src.normalScale);
    (src as Material).dispose();
    rig = new BirdRig(
      (mesh as Mesh).geometry,
      mat,
      buildExtrasGeometry(),
      new MeshLambertMaterial({ vertexColors: true }),
      BLENDS[blend],
    );
  } catch (err) {
    api.error = String((err as Error)?.message ?? err);
    overlay.textContent = `rig failed: ${api.error}`;
    return;
  }
  scene.add(rig.root);
  const lm = rig.landmarks;
  console.info(`[rig] ${describeRig(lm, rig.shoulderBlend)}`);

  const camPos = new Vector3();
  function applyView(): void {
    const c = cameraFor(view, lm.shoulderX, lm.wingY);
    camPos.set(
      Math.sin(c.az * DEG) * Math.cos(c.el * DEG),
      Math.sin(c.el * DEG),
      Math.cos(c.az * DEG) * Math.cos(c.el * DEG),
    );
    camera.position.copy(c.target).addScaledVector(camPos, c.dist);
    camera.lookAt(c.target);
    // sun: from above and to the camera's left, like the game's (-1, 2, 3)
    sun.position.copy(camera.position).add(camPos.set(0, 2, 0));
    sun.target.position.copy(c.target);
  }

  function applyPose(t: number): void {
    if (pose === 'folded') {
      rig.setWingFold(1);
      return;
    }
    rig.setWingFold(0);
    if (pose === 'beat') {
      // Full beat loop at 2.5 beats/s: down-stroke to −60°, up-stroke to +60°.
      rig.setWingAngle(60 * Math.sin(t * 2.5 * 2 * Math.PI));
    } else {
      rig.setWingAngle(Number(pose));
    }
  }

  const buttons: HTMLButtonElement[] = [];
  function button(label: string, on: () => boolean, click: () => void): void {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = 'padding:6px 10px;border:1px solid #888;border-radius:6px;background:#fff;color:#111';
    b.addEventListener('click', () => {
      click();
      refresh();
    });
    (b as unknown as { isOn: () => boolean }).isOn = on;
    buttons.push(b);
    bar.appendChild(b);
  }
  for (const p of POSES) button(p === 'folded' ? 'folded' : p === 'beat' ? 'beat loop' : `${p}°`, () => pose === p, () => (pose = p));
  for (const v of VIEWS) button(v, () => view === v, () => (view = v));
  for (const b of Object.keys(BLENDS) as BlendName[]) {
    const { inner, outer } = BLENDS[b];
    button(`blend ${inner}-${outer}`, () => blend === b, () => setBlend(b));
  }

  function setBlend(b: BlendName): void {
    blend = b;
    rig.setShoulderBlend(BLENDS[b]);
  }

  function refresh(): void {
    for (const b of buttons) {
      const on = (b as unknown as { isOn: () => boolean }).isOn();
      b.style.background = on ? '#248F59' : '#fff';
      b.style.color = on ? '#fff' : '#111';
    }
    bar.style.display = ui ? 'flex' : 'none';
    overlay.style.display = ui ? 'block' : 'none';
    applyView();
  }

  api.set = (o) => {
    if (o.pose) pose = o.pose;
    if (o.view) view = o.view;
    if (o.blend && o.blend !== blend) setBlend(o.blend);
    if (o.ui !== undefined) ui = o.ui;
    refresh();
  };

  function resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();
  refresh();

  let calls = 0;
  let triangles = 0;
  let fps = 0;
  let frames = 0;
  let fpsStart = performance.now();
  let overlayAt = 0;
  api.info = () => ({ calls, triangles, fps, rig: describeRig(lm, rig.shoulderBlend), pose, view, blend });

  // Body silhouette for the penetration check: per 0.02 of height, the largest radius
  // sqrt(x² + z²) of the vertices that stay fully on the body (bind pose).
  const geo = rig.mesh.geometry;
  const posAttr = geo.getAttribute('position');
  const skinW = geo.getAttribute('skinWeight');
  const Y0 = -0.75;
  const bodyR = new Float32Array(80);
  for (let i = 0; i < posAttr.count; i++) {
    if (skinW.getX(i) < 0.999) continue;
    const b = Math.floor((posAttr.getY(i) - Y0) / 0.02);
    if (b >= 0 && b < bodyR.length) bodyR[b] = Math.max(bodyR[b], Math.hypot(posAttr.getX(i), posAttr.getZ(i)));
  }
  const v = new Vector3();
  api.setFold = (d, b, r) => rig.setFoldPose(d, b, r);
  api.setHinge = (dx, dy) => rig.setDownHinge(dx, dy);
  api.penetration = () => {
    applyPose(0);
    rig.root.updateMatrixWorld(true);
    rig.skeleton.update();
    let vertices = 0;
    let deepest = 0;
    for (let i = 0; i < posAttr.count; i++) {
      if (skinW.getZ(i) < 0.5) continue; // mostly wing
      rig.mesh.getVertexPosition(i, v);
      const b = Math.floor((v.y - Y0) / 0.02);
      if (b < 0 || b >= bodyR.length || bodyR[b] === 0) continue;
      const depth = bodyR[b] - Math.hypot(v.x, v.z);
      if (depth > 0.01) {
        vertices++;
        deepest = Math.max(deepest, depth);
      }
    }
    return { vertices, deepest: Math.round(deepest * 1000) / 1000 };
  };

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
        `Joud rig prototype  fps ${fps}  draw calls ${calls}  tris ${triangles}\n` +
        `pose ${pose}  view ${view}\n${describeRig(lm, rig.shoulderBlend)}`;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  api.ready = true;
}
