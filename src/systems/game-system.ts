import {
  createSystem,
  type Entity,
  Hovered,
  Quaternion,
  RayInteractable,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { type Config, parseOverrides, type UrlFlags } from '../core/config';
import { Game, type GameState } from '../core/game';
import { type GameCommand, InputBus } from '../core/input';
import { createOverlay, type Overlay } from '../scene/overlay';
import {
  attractArt,
  gameOverArt,
  hudArt,
  type Mode,
  pausedArt,
  readyArt,
  recentreArt,
  scoreArt,
} from '../scene/panel-art';
import { PlayWindow } from '../scene/play-window';
import { loadBest, saveBest } from '../scene/storage';
import { attachDesktopInput } from './desktop-input';

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
  private cfg!: Config;
  private flags!: UrlFlags;
  private game!: Game;
  private bus!: InputBus;
  private view!: PlayWindow;
  private overlay!: Overlay;
  private recentreEntity!: Entity;

  private session: XRSession | null = null;
  private immersive = false;
  private needsXRPlacement = false;
  private needsDesktopPlacement = true;
  private readonly headPos = new Vector3();
  private readonly headQuat = new Quaternion();
  private readonly tmpQuat = new Quaternion();

  // panel cache: redraw only when something visible changes
  private drawnState: GameState | '' = '';
  private drawnMode: Mode | '' = '';
  private drawnScore = -1;
  private drawnRestart = false;
  private drawnBest = -1;

  // debug HUD
  private lastProfile = '-';
  private lastButton = -1;
  private lastError = '-';
  private frames = 0;
  private fpsTime = 0;
  private fps = 0;
  private hudTime = 0;
  private hudEl: HTMLElement | null = null;
  private readonly hudLines: string[] = [];

  init(): void {
    const parsed = parseOverrides(window.location.search);
    this.cfg = parsed.cfg;
    this.flags = parsed.flags;
    this.game = new Game(this.cfg, { best: loadBest() });
    this.bus = new InputBus();
    this.view = new PlayWindow(this.cfg);

    this.world.createTransformEntity(this.view.environment, { persistent: true });
    const rigEntity = this.world.createTransformEntity(this.view.rig, { persistent: true });
    this.recentreEntity = this.world.createTransformEntity(this.view.recentre.mesh, {
      parent: rigEntity,
    });
    this.recentreEntity.addComponent(RayInteractable);
    this.view.recentre.mesh.position.set(0, -0.5, 0.2);
    this.view.recentre.redraw(recentreArt());

    this.renderer.xr.setFoveation(1);

    this.overlay = createOverlay(() => this.world.launchXR());
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
      ),
    );

    const onError = (e: ErrorEvent) => (this.lastError = String(e.message).slice(0, 60));
    const onRejection = (e: PromiseRejectionEvent) =>
      (this.lastError = String(e.reason).slice(0, 60));
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    this.cleanupFuncs.push(
      () => window.removeEventListener('error', onError),
      () => window.removeEventListener('unhandledrejection', onRejection),
      () => this.detachSession(),
    );

    if (this.flags.debug) {
      this.hudEl = document.getElementById('hud');
      if (this.hudEl) this.hudEl.hidden = false;
      // ?debug=1 only: lets emulator/desktop checks read game state.
      (window as unknown as { joudBird: unknown }).joudBird = {
        game: this.game,
        renderer: this.renderer,
        rig: this.view.rig,
        camera: this.camera,
        cfg: this.cfg,
      };
    }
  }

  update(delta: number, time: number): void {
    if (this.immersive) {
      this.pollXRButtons();
      if (this.needsXRPlacement) this.tryPlaceXR();
    } else if (this.needsDesktopPlacement) {
      this.placeForDesktop();
    }

    this.bus.drain(this.handleCommand);
    this.game.advance(delta);
    this.consumeEvents();
    this.view.sync(this.game, delta, time);
    this.updatePanels();
    if (this.flags.debug) this.updateHud(delta);
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
      // Session ended: back to the Attract page for the next visitor.
      this.detachSession();
      this.game.toAttract();
      this.needsDesktopPlacement = true;
    }
    if (v === VisibilityState.VisibleBlurred || v === VisibilityState.Hidden) {
      this.game.suspend();
    }
    this.immersive = immersive;
    this.overlay.setImmersive(immersive);
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
    if (this.game.state === 'attract' && this.recentreEntity.hasComponent(Hovered)) {
      this.needsXRPlacement = true;
      return;
    }
    this.bus.push('flap');
  };

  private pollXRButtons(): void {
    const pads = this.input.xr.gamepads;
    for (const hand of HANDS) {
      const pad = pads[hand];
      if (!pad) continue;
      if (pad.getButtonDownByIdx(BUTTON_RESTART)) this.bus.push('restart');
      if (pad.getButtonDownByIdx(BUTTON_PAUSE)) this.bus.push('pause');
      if (this.flags.debug) {
        const n = pad.gamepad.buttons.length;
        for (let i = 0; i < n; i++) if (pad.getButtonDownByIdx(i)) this.lastButton = i;
        if (this.lastProfile === '-') this.lastProfile = pad.inputSource.profiles[0] ?? '-';
      }
    }
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

  /** Desktop: same placement from the fixed browser camera, sized to fit the window. */
  private placeForDesktop(): void {
    const cam = this.camera;
    cam.updateMatrixWorld(true);
    cam.getWorldPosition(this.headPos);
    cam.getWorldQuaternion(this.headQuat);
    const tanV = Math.tan((cam.fov * Math.PI) / 360);
    const tanH = tanV * cam.aspect;
    const fitH = (this.cfg.laneH + 0.9) / (2 * tanV); // lane plus score and hint rows
    const fitW = (this.cfg.laneW + 0.3) / (2 * tanH);
    this.view.place(this.headPos, this.headQuat, Math.max(fitH, fitW));
    this.needsDesktopPlacement = false;
  }

  // ---------- events, panels, HUD ----------

  private consumeEvents(): void {
    const events = this.game.events;
    for (let i = 0; i < events.length; i++) {
      switch (events[i]) {
        case 'flap':
          this.view.onFlap();
          break;
        case 'hit':
          this.view.onHit();
          this.pulse();
          break;
        case 'newBest':
          saveBest(this.game.best);
          break;
      }
    }
    events.length = 0;
  }

  /** Short haptic pulse on hit. Optional: the game works without it. */
  private pulse(): void {
    for (const hand of HANDS) {
      const pad = this.input.xr.gamepads[hand];
      const actuator = (pad?.gamepad as { hapticActuators?: { pulse?: (v: number, ms: number) => Promise<unknown> }[] } | undefined)
        ?.hapticActuators?.[0];
      try {
        actuator?.pulse?.(0.7, 120)?.catch(() => {});
      } catch {
        // permission missing or unsupported
      }
    }
  }

  private updatePanels(): void {
    const g = this.game;
    const v = this.view;
    const mode: Mode = this.immersive ? 'xr' : 'desktop';
    const st = g.state;
    const canRestart = g.canRestartWithTrigger;
    const changed = st !== this.drawnState || mode !== this.drawnMode;

    if (changed || (st === 'gameOver' && canRestart !== this.drawnRestart) || g.best !== this.drawnBest) {
      v.attract.visible = st === 'attract';
      v.ready.visible = st === 'ready';
      v.gameOver.visible = st === 'gameOver';
      v.paused.visible = st === 'paused';
      v.score.visible = st !== 'attract';
      v.recentre.visible = st === 'attract' && this.immersive;
      if (st === 'attract') v.attract.redraw(attractArt(g.best, mode));
      if (st === 'ready') v.ready.redraw(readyArt(mode));
      if (st === 'gameOver') v.gameOver.redraw(gameOverArt(g.score, g.best, g.newBest, canRestart, mode));
      if (st === 'paused') v.paused.redraw(pausedArt(mode));
      this.drawnState = st;
      this.drawnMode = mode;
      this.drawnRestart = canRestart;
      this.drawnBest = g.best;
    }
    if (g.score !== this.drawnScore) {
      v.score.redraw(scoreArt(g.score));
      this.drawnScore = g.score;
    }
  }

  private updateHud(delta: number): void {
    this.frames++;
    this.fpsTime += delta;
    if (this.fpsTime >= 0.5) {
      this.fps = this.frames / this.fpsTime;
      this.frames = 0;
      this.fpsTime = 0;
    }
    this.hudTime += delta;
    if (this.hudTime < 0.25) return;
    this.hudTime = 0;

    const info = this.renderer.info.render;
    const xrState = this.world.visibilityState.value;
    const l = this.hudLines;
    l.length = 0;
    l.push(`fps ${this.fps.toFixed(1)}   state ${this.game.state}   score ${this.game.score}`);
    l.push(`xr ${xrState}${this.session ? ' (session)' : ''}`);
    l.push(`profile ${this.lastProfile}`);
    l.push(`last button ${this.lastButton}   last cmd ${this.bus.last ?? '-'}`);
    l.push(`calls ${info.calls}   tris ${info.triangles}`);
    l.push(`bird placeholder (model=${this.flags.model})`);
    l.push(`best ${this.game.best}   speed ${this.game.speed.toFixed(2)}   gap ${this.game.gap.toFixed(2)}`);
    l.push(`err ${this.lastError}`);

    if (this.immersive) {
      this.view.hud.visible = true;
      this.view.hud.redraw(hudArt(l));
    } else {
      this.view.hud.visible = false;
      if (this.hudEl) this.hudEl.textContent = l.join('\n');
    }
  }
}
