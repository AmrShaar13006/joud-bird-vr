// Plain Three.js + WebXR shell around the same src/core. Insurance for the
// headset session if the IWSDK build misbehaves on the Quest.
// No IWSDK imports anywhere under src/fallback/ (or in the src/scene code it uses).

import { PerspectiveCamera, Quaternion, Scene, Vector3, WebGLRenderer } from 'three';
import { configFor, parseUrl } from '../core/config';
import { Game } from '../core/game';
import { type GameCommand, InputBus } from '../core/input';
import { JOUD_GLB_URL } from '../scene/bird';
import { DebugHud } from '../scene/debug-hud';
import { attachDesktopInput } from '../scene/desktop-input';
import { createOverlay } from '../scene/overlay';
import { PanelController } from '../scene/panels';
import { PlayWindow } from '../scene/play-window';
import { loadBest, saveBest } from '../scene/storage';
import { STRINGS } from '../scene/strings';

/** xr-standard mapping on Quest Touch (Plus): 4 = A/X, 5 = B/Y. */
const BUTTON_RESTART = 4;
const BUTTON_PAUSE = 5;

// ---------- core ----------
const url = parseUrl(window.location.search);
const cfg = configFor(url.mode, url.overrides); // mode via ?mode= only (no picker here)
const game = new Game(cfg, { best: loadBest(url.mode), mode: url.mode });
const bus = new InputBus();
const handle = (cmd: GameCommand) => game.handle(cmd);

// ---------- renderer, scene, camera ----------
const container = document.getElementById('scene-container') as HTMLElement;
const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setFoveation(1);
container.appendChild(renderer.domElement);

const scene = new Scene();
const view = new PlayWindow(cfg, { fx: url.flags.fx });
if (url.flags.model === 'joud') void view.bird.load(JOUD_GLB_URL);
scene.add(view.environment, view.rig); // recentre and mode buttons stay out (IWSDK build only)

const DESKTOP_EYE = new Vector3(0, 1.2, 0);
const DESKTOP_TARGET = new Vector3(0, 1.2, -2.5);
const DESKTOP_FOV = 70;
const camera = new PerspectiveCamera(DESKTOP_FOV, window.innerWidth / window.innerHeight, 0.05, 200);
/** WebXRManager copies the headset pose and field of view onto the camera; undo both. */
function resetDesktopCamera(): void {
  camera.position.copy(DESKTOP_EYE);
  camera.quaternion.identity();
  camera.lookAt(DESKTOP_TARGET);
  camera.fov = DESKTOP_FOV;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.zoom = 1;
  camera.updateProjectionMatrix();
}
resetDesktopCamera();

let needsDesktopPlacement = true;
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  needsDesktopPlacement = true;
});

// ---------- 2D page, panels, HUD ----------
const overlay = createOverlay(() => void enterVR(), STRINGS.desktopHintNoPicker);
const panels = new PanelController(view, overlay, { picker: false, recentre: false });
const hud = url.flags.debug ? new DebugHud(view.hud) : null;
let lastProfile = '-';
let lastButton = -1;
let lastError = '-';
window.addEventListener('error', (e) => (lastError = String(e.message).slice(0, 60)));
window.addEventListener('unhandledrejection', (e) => (lastError = String(e.reason).slice(0, 60)));

// ---------- XR session ----------
let session: XRSession | null = null;
let needsXRPlacement = false;
/** Last pressed state of buttons 4 and 5 per controller (rising-edge detection). */
const prevButtons = new WeakMap<XRInputSource, [boolean, boolean]>();

async function enterVR(): Promise<void> {
  if (!navigator.xr || session) return;
  try {
    const s = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor'],
    });
    // local-floor if the device grants it, otherwise local.
    let type: XRReferenceSpaceType = 'local';
    try {
      await s.requestReferenceSpace('local-floor');
      type = 'local-floor';
    } catch {
      // keep 'local'
    }
    renderer.xr.setReferenceSpaceType(type);
    s.addEventListener('selectstart', onSelectStart);
    s.addEventListener('visibilitychange', onSessionVisibility);
    s.addEventListener('end', onSessionEnd);
    await renderer.xr.setSession(s);
    session = s;
    needsXRPlacement = true;
    game.toAttract();
  } catch (err) {
    lastError = String(err).slice(0, 60);
  }
}

/** Trigger on either controller = flap/start (session event, not polling). */
function onSelectStart(e: XRInputSourceEvent): void {
  lastProfile = e.inputSource.profiles[0] ?? '-';
  bus.push('flap');
}

function onSessionVisibility(): void {
  if (session && session.visibilityState !== 'visible') game.suspend();
}

function onSessionEnd(): void {
  session?.removeEventListener('selectstart', onSelectStart);
  session?.removeEventListener('visibilitychange', onSessionVisibility);
  session?.removeEventListener('end', onSessionEnd);
  session = null;
  game.toAttract(); // back to the Attract page for the next visitor
  resetDesktopCamera(); // WebXRManager leaves the last head pose on the camera
  needsDesktopPlacement = true;
}

function pollXRButtons(s: XRSession): void {
  for (const source of s.inputSources) {
    const gp = source.gamepad;
    if (!gp) continue;
    let prev = prevButtons.get(source);
    if (!prev) {
      prev = [false, false];
      prevButtons.set(source, prev);
    }
    const restart = gp.buttons[BUTTON_RESTART]?.pressed ?? false;
    const pause = gp.buttons[BUTTON_PAUSE]?.pressed ?? false;
    if (restart && !prev[0]) {
      bus.push('restart');
      lastButton = BUTTON_RESTART;
    }
    if (pause && !prev[1]) {
      bus.push('pause');
      lastButton = BUTTON_PAUSE;
    }
    prev[0] = restart;
    prev[1] = pause;
  }
}

const headPos = new Vector3();
const headQuat = new Quaternion();
function tryPlaceXR(frame: XRFrame): void {
  const ref = renderer.xr.getReferenceSpace();
  const pose = ref ? frame.getViewerPose(ref) : null;
  if (!pose) return;
  const p = pose.transform.position;
  const o = pose.transform.orientation;
  headPos.set(p.x, p.y, p.z);
  headQuat.set(o.x, o.y, o.z, o.w);
  view.place(headPos, headQuat);
  needsXRPlacement = false;
}

// ---------- desktop input (identical to the main build, minus the picker) ----------
attachDesktopInput(
  renderer.domElement,
  bus,
  () => !session,
  () => {
    if (!session) game.suspend();
  },
);

// ---------- loop: fixed 1/120 s steps inside setAnimationLoop, clamped at 0.1 s ----------
let lastTime = -1;
renderer.setAnimationLoop((time: number, frame?: XRFrame) => {
  const delta = lastTime < 0 ? 0 : (time - lastTime) / 1000;
  lastTime = time;
  const immersive = renderer.xr.isPresenting;

  if (immersive && session) {
    pollXRButtons(session);
    if (needsXRPlacement && frame) tryPlaceXR(frame);
  } else if (needsDesktopPlacement) {
    view.placeForCamera(camera);
    needsDesktopPlacement = false;
  }

  bus.drain(handle);
  game.advance(delta); // Game steps at cfg.step (1/120 s) and clamps to cfg.maxFrame (0.1 s)
  for (const e of game.events) {
    if (e === 'flap') view.onFlap();
    else if (e === 'hit') view.onHit();
    else if (e === 'newBest') saveBest(game.mode, game.best);
  }
  game.events.length = 0;

  view.sync(game, delta, time / 1000);
  panels.update(game, immersive);
  if (hud?.tick(delta)) {
    const info = renderer.info.render;
    hud.show(
      {
        shell: 'fallback',
        state: game.state,
        score: game.score,
        xr: session ? `${session.visibilityState} (session)` : 'non-immersive',
        profile: lastProfile,
        lastButton,
        lastCmd: bus.last ?? '-',
        calls: info.calls,
        tris: info.triangles,
        model: view.bird.status,
        mode: game.mode,
        best: game.best,
        speed: game.speed,
        gap: game.gap,
        error: lastError,
      },
      immersive,
    );
  }
  renderer.render(scene, camera);
});

if (url.flags.debug) {
  // ?debug=1 only: lets emulator/desktop checks read game state.
  (window as unknown as { joudBird: unknown }).joudBird = { game, renderer, rig: view.rig, view, camera };
}
