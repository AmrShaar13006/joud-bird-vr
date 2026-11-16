import {
  createSystem,
  type Entity,
  Hovered,
  Matrix4,
  type Mesh,
  Quaternion,
  RayInteractable,
  Raycaster,
  Vector2,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { type Config, configFor, type Mode, MODES, parseUrl, type UrlFlags } from '../core/config';
import { Game } from '../core/game';
import { type GameCommand, InputBus } from '../core/input';
import { Sfx } from '../scene/audio';
import { JOUD_GLB_URL } from '../scene/bird';
import { DebugHud } from '../scene/debug-hud';
import { attachDesktopInput } from '../scene/desktop-input';
import { createOverlay } from '../scene/overlay';
import { recentreArt } from '../scene/panel-art';
import { PanelController } from '../scene/panels';
import { PlayWindow } from '../scene/play-window';
import { loadBest, saveBest } from '../scene/storage';
import { STRINGS } from '../scene/strings';

const HANDS = ['left', 'right'] as const;
/** xr-standard mapping on Quest Touch (Plus): 4 = A/X, 5 = B/Y. */
const BUTTON_RESTART = 4;
const BUTTON_PAUSE = 5;

/**
 * The IWSDK shell around src/core: maps XR and desktop input onto the
 * InputBus, runs the fixed-step game, and copies its state to the scene.
 * It never decides game rules itself.
 */
export class GameSystem extends createSystem({}) {
  private overrides: Partial<Config> = {};
  private defaultMode: Mode = 'normal';
  private flags!: UrlFlags;
  private game!: Game;
  private bus!: InputBus;
  private view!: PlayWindow;
  private panels!: PanelController;
  private hud: DebugHud | null = null;
  private recentreEntity!: Entity;
  private muteEntity!: Entity;
  private sfx!: Sfx;
  private modeEntities = {} as Record<Mode, Entity>;
  private modeMeshes: Mesh[] = [];
  /** Ray targets on the attract screen: recentre + mode buttons. */
  private attractTargets: Mesh[] = [];
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly rayMatrix = new Matrix4();
  private readonly rayOrigin = new Vector3();
  private readonly rayDir = new Vector3();

  private session: XRSession | null = null;
  private immersive = false;
  private needsXRPlacement = false;
  private needsDesktopPlacement = true;
  private readonly headPos = new Vector3();
  private readonly headQuat = new Quaternion();
  private readonly tmpQuat = new Quaternion();

  // debug HUD
  private lastProfile = '-';
  private lastButton = -1;
  private lastError = '-';

  init(): void {
    const url = parseUrl(window.location.search);
    this.overrides = url.overrides;
    this.defaultMode = url.mode;
    this.flags = url.flags;
    const cfg = configFor(url.mode, url.overrides);
    this.game = new Game(cfg, { best: loadBest(url.mode), mode: url.mode });
    this.bus = new InputBus();
    this.sfx = new Sfx(url.flags.mute);
    this.view = new PlayWindow(cfg, { fx: url.flags.fx });
    if (url.flags.model === 'joud') void this.view.bird.load(JOUD_GLB_URL);

    this.world.createTransformEntity(this.view.environment, { persistent: true });
    const rigEntity = this.world.createTransformEntity(this.view.rig, { persistent: true });
    // Ray targets each need their own entity; keep the positions PlayWindow set.
    const attachButton = (mesh: Mesh): Entity => {
      const pos = mesh.position.clone();
      const entity = this.world.createTransformEntity(mesh, { parent: rigEntity });
      mesh.position.copy(pos);
      entity.addComponent(RayInteractable);
      return entity;
    };
    this.recentreEntity = attachButton(this.view.recentre.mesh);
    this.view.recentre.redraw(recentreArt());
    for (const m of MODES) {
      this.modeEntities[m] = attachButton(this.view.modeButtons[m].mesh);
      this.modeMeshes.push(this.view.modeButtons[m].mesh);
    }
    this.muteEntity = attachButton(this.view.muteButton.mesh);
    this.attractTargets = [this.view.recentre.mesh, this.view.muteButton.mesh, ...this.modeMeshes];

    this.renderer.xr.setFoveation(1);

    const overlay = createOverlay(() => {
      this.sfx.unlock(); // the Enter VR click is a user gesture
      this.world.launchXR();
    }, STRINGS.desktopHint);
    this.panels = new PanelController(this.view, overlay, { picker: true, recentre: true, mute: true });
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((v) => this.onVisibility(v)),
      attachDesktopInput(
        this.renderer.domElement,
        this.bus,
        () => !this.immersive,
        // Desktop only: in XR the session's visibility-blurred state decides.
        () => {
          if (!this.immersive) this.game.suspend();
        },
        {
          onModeKey: (i) => this.selectMode(MODES[i]),
          pick: (x, y) => this.pickModeButton(x, y),
          onMuteKey: () => this.toggleMute(),
          onGesture: () => this.sfx.unlock(),
        },
      ),
    );

    const onError = (e: ErrorEvent) => (this.lastError = String(e.message).slice(0, 60));
    const onRejection = (e: PromiseRejectionEvent) =>
      (this.lastError = String(e.reason).slice(0, 60));
    // Re-fit the desktop window after a resize (TV, window snap, a page loaded while hidden).
    const onResize = () => {
      this.needsDesktopPlacement = true;
    };
    window.addEventListener('resize', onResize);
    this.cleanupFuncs.push(() => window.removeEventListener('resize', onResize));
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    this.cleanupFuncs.push(
      () => window.removeEventListener('error', onError),
      () => window.removeEventListener('unhandledrejection', onRejection),
      () => this.detachSession(),
    );

    if (this.flags.debug) {
      this.hud = new DebugHud(this.view.hud);
      // ?debug=1 only: lets emulator/desktop checks read game state.
      (window as unknown as { joudBird: unknown }).joudBird = {
        game: this.game,
        renderer: this.renderer,
        rig: this.view.rig,
        view: this.view,
        camera: this.camera,
        sfx: this.sfx,
      };
    }
  }

  update(delta: number, time: number): void {
    if (this.immersive) {
      this.pollXRButtons();
      if (this.needsXRPlacement) this.tryPlaceXR();
    } else if (this.needsDesktopPlacement) {
      this.view.placeForCamera(this.camera);
      this.needsDesktopPlacement = false;
    }

    this.bus.drain(this.handleCommand);
    this.game.advance(delta);
    this.consumeEvents();
    this.view.sync(this.game, delta, time);
    this.panels.update(this.game, this.immersive, this.sfx.muted);
    this.updateHover();
    if (this.hud?.tick(delta)) this.showHud();
  }

  private readonly handleCommand = (cmd: GameCommand): void => {
    this.game.handle(cmd);
  };

  // ---------- lifecycle ----------

  private onVisibility(v: VisibilityState): void {
    const immersive = v !== VisibilityState.NonImmersive;
    if (immersive && !this.immersive) {
      this.attachSession();
      this.needsXRPlacement = true;
      this.game.toAttract();
    } else if (!immersive && this.immersive) {
      // Session ended: back to the Attract page, in the operator's default mode.
      this.detachSession();
      this.game.toAttract();
      this.selectMode(this.defaultMode);
      this.needsDesktopPlacement = true;
    }
    if (v === VisibilityState.VisibleBlurred || v === VisibilityState.Hidden) {
      this.game.suspend();
    }
    this.immersive = immersive;
  }

  private attachSession(): void {
    const s = this.world.session ?? null;
    if (!s || s === this.session) return;
    this.detachSession();
    this.session = s;
    s.addEventListener('selectstart', this.onSelectStart);
  }

  private detachSession(): void {
    this.session?.removeEventListener('selectstart', this.onSelectStart);
    this.session = null;
  }

  /** Trigger on either controller (session event, not polling). */
  private readonly onSelectStart = (e: XRInputSourceEvent): void => {
    this.lastProfile = e.inputSource.profiles[0] ?? '-';
    this.sfx.unlock(); // the trigger is a user gesture
    if (this.game.state === 'attract' && this.handleAttractTarget(e)) return;
    this.bus.push('flap');
  };

  /**
   * Attract screen: if the controller that pulled the trigger points at the
   * recentre or a mode button, act on it and swallow the press. Uses that
   * controller's own ray (both rays can rest on different buttons); falls
   * back to IWSDK's Hovered tags if the pose is unavailable.
   */
  private handleAttractTarget(e: XRInputSourceEvent): boolean {
    const hit = this.rayHit(e);
    if (hit === undefined) {
      if (this.recentreEntity.hasComponent(Hovered)) return this.recentre();
      if (this.muteEntity.hasComponent(Hovered)) return this.toggleMute();
      for (const m of MODES) {
        if (this.modeEntities[m].hasComponent(Hovered)) {
          this.selectMode(m);
          return true;
        }
      }
      return false;
    }
    if (hit === null) return false;
    if (hit === this.view.recentre.mesh) return this.recentre();
    if (hit === this.view.muteButton.mesh) return this.toggleMute();
    const mode = MODES.find((m) => this.view.modeButtons[m].mesh === hit);
    if (!mode) return false;
    this.selectMode(mode);
    return true;
  }

  private recentre(): boolean {
    this.needsXRPlacement = true;
    this.sfx.click();
    return true;
  }

  /** Click first when muting, after when un-muting, so both give feedback. */
  private toggleMute(): boolean {
    if (this.sfx.muted) {
      this.sfx.setMuted(false);
      this.sfx.click();
    } else {
      this.sfx.click();
      this.sfx.setMuted(true);
    }
    return true;
  }

  /** What the event's controller ray hits: a target, null for nothing, undefined if no pose. */
  private rayHit(e: XRInputSourceEvent): Mesh | null | undefined {
    const ref = this.world.xrReferenceSpace;
    if (!ref) return undefined;
    let pose: XRPose | undefined | null;
    try {
      pose = e.frame.getPose(e.inputSource.targetRaySpace, ref);
    } catch {
      return undefined;
    }
    if (!pose) return undefined;
    this.player.updateMatrixWorld(true);
    this.rayMatrix.fromArray(pose.transform.matrix).premultiply(this.player.matrixWorld);
    this.rayOrigin.setFromMatrixPosition(this.rayMatrix);
    this.rayDir.set(0, 0, -1).transformDirection(this.rayMatrix);
    this.raycaster.set(this.rayOrigin, this.rayDir);
    this.view.rig.updateMatrixWorld(true);
    const hit = this.raycaster.intersectObjects(this.attractTargets, false)[0];
    return hit ? (hit.object as Mesh) : null;
  }

  private pollXRButtons(): void {
    const pads = this.input.xr.gamepads;
    for (const hand of HANDS) {
      const pad = pads[hand];
      if (!pad) continue;
      if (pad.getButtonDownByIdx(BUTTON_RESTART)) this.bus.push('restart');
      if (pad.getButtonDownByIdx(BUTTON_PAUSE)) this.bus.push('pause');
      if (this.hud) {
        const n = pad.gamepad.buttons.length;
        for (let i = 0; i < n; i++) if (pad.getButtonDownByIdx(i)) this.lastButton = i;
        if (this.lastProfile === '-') this.lastProfile = pad.inputSource.profiles[0] ?? '-';
      }
    }
  }

  // ---------- difficulty ----------

  /** Switch mode between rounds (Attract screen only); loads that mode's best. */
  private selectMode(mode: Mode | undefined): void {
    if (!mode || this.game.state !== 'attract' || mode === this.game.mode) return;
    if (this.game.configure(configFor(mode, this.overrides), mode, loadBest(mode))) this.sfx.click();
  }

  /** Desktop click/touch on a mode button. Returns true if it hit one. */
  private pickModeButton(clientX: number, clientY: number): boolean {
    if (this.game.state !== 'attract') return false;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.attractTargets, false)[0];
    if (!hit) return false;
    if (hit.object === this.view.recentre.mesh) return false; // VR only
    if (hit.object === this.view.muteButton.mesh) return this.toggleMute();
    this.selectMode(MODES.find((m) => this.view.modeButtons[m].mesh === hit.object));
    return true;
  }

  /** Hovered ray targets grow a little so the player sees what the trigger will press. */
  private updateHover(): void {
    if (this.game.state !== 'attract' || !this.immersive) return;
    for (const m of MODES) {
      const hovered = this.modeEntities[m].hasComponent(Hovered);
      this.view.modeButtons[m].mesh.scale.setScalar(hovered ? 1.08 : 1);
    }
    this.view.recentre.mesh.scale.setScalar(this.recentreEntity.hasComponent(Hovered) ? 1.08 : 1);
    this.view.muteButton.mesh.scale.setScalar(this.muteEntity.hasComponent(Hovered) ? 1.08 : 1);
  }

  // ---------- placement ----------

  /** First XR frame (and recentre): put the rig ahead of the head. */
  private tryPlaceXR(): void {
    const frame = this.world.xrFrame;
    const ref = this.world.xrReferenceSpace;
    if (!frame || !ref) return;
    const pose = frame.getViewerPose(ref);
    if (!pose) return;
    const p = pose.transform.position;
    const o = pose.transform.orientation;
    this.headPos.set(p.x, p.y, p.z);
    this.headQuat.set(o.x, o.y, o.z, o.w);
    // Viewer pose is in reference-space coords, i.e. local to the player origin.
    this.player.updateMatrixWorld(true);
    this.headPos.applyMatrix4(this.player.matrixWorld);
    this.player.getWorldQuaternion(this.tmpQuat);
    this.headQuat.premultiply(this.tmpQuat);
    this.view.place(this.headPos, this.headQuat);
    this.needsXRPlacement = false;
  }

  // ---------- events, HUD ----------

  private consumeEvents(): void {
    const events = this.game.events;
    for (let i = 0; i < events.length; i++) {
      switch (events[i]) {
        case 'flap':
          this.view.onFlap();
          this.sfx.flap();
          break;
        case 'score':
          this.sfx.score(this.game.score);
          break;
        case 'hit':
          this.view.onHit();
          this.sfx.hit();
          this.pulse();
          break;
        case 'newBest':
          saveBest(this.game.mode, this.game.best);
          break;
      }
    }
    events.length = 0;
  }

  /** Short haptic pulse on hit. Optional: the game works without it. */
  private pulse(): void {
    for (const hand of HANDS) {
      const pad = this.input.xr.gamepads[hand];
      const actuator = (
        pad?.gamepad as
          | { hapticActuators?: { pulse?: (v: number, ms: number) => Promise<unknown> }[] }
          | undefined
      )?.hapticActuators?.[0];
      try {
        actuator?.pulse?.(0.7, 120)?.catch(() => {});
      } catch {
        // permission missing or unsupported
      }
    }
  }

  private showHud(): void {
    const g = this.game;
    const info = this.renderer.info.render;
    this.hud?.show(
      {
        shell: 'iwsdk',
        state: g.state,
        score: g.score,
        xr: `${this.world.visibilityState.value}${this.session ? ' (session)' : ''}`,
        profile: this.lastProfile,
        lastButton: this.lastButton,
        lastCmd: this.bus.last ?? '-',
        calls: info.calls,
        tris: info.triangles,
        model: this.view.bird.status,
        mode: g.mode,
        best: g.best,
        speed: g.speed,
        gap: g.gap,
        sound: this.sfx.muted ? 'muted' : this.sfx.unlocked ? 'on' : 'waiting for a gesture',
        error: this.lastError,
      },
      this.immersive,
    );
  }
}
