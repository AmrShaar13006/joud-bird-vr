import {
  BackSide,
  BoxGeometry,
  CircleGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { type Config, type Mode, MODES } from '../core/config';
import type { Game } from '../core/game';
import { POOL_SIZE } from '../core/obstacles';
import { CanvasPanel } from './canvas-panel';

const SKY_TOP = new Color('#6fb8e8');
const SKY_HORIZON = new Color('#fde9c9');
const DEG = Math.PI / 180;

/** Depths in rig space (+Z faces the player). */
const Z = { laneBg: -0.15, frame: 0.0, bird: 0, obstacle: 0, panel: 0.18, button: 0.2 };

/**
 * Everything the player sees. `environment` is world-fixed (sky, ground,
 * lights); `rig` is the PlayRig placed once per player. Lane coordinates:
 * x right, y up, origin at the lane centre, all inside `rig`.
 */
export class PlayWindow {
  readonly environment = new Group();
  readonly rig = new Group();
  readonly ground: Mesh;
  readonly bird: Mesh<SphereGeometry, MeshLambertMaterial>;
  /** [top, bottom] meshes per pool slot. */
  readonly obstacleMeshes: Mesh[][] = [];
  readonly attract: CanvasPanel;
  readonly ready: CanvasPanel;
  readonly gameOver: CanvasPanel;
  readonly paused: CanvasPanel;
  readonly score: CanvasPanel;
  readonly recentre: CanvasPanel;
  readonly hud: CanvasPanel;
  /** Mode picker buttons (Attract screen). Parented by the shell. */
  readonly modeButtons: Record<Mode, CanvasPanel>;

  private squash = 0;
  private flash = 0;
  private readonly tmpFwd = new Vector3();
  private readonly tmpPos = new Vector3();
  private readonly tmpQuat = new Quaternion();

  constructor(private readonly cfg: Readonly<Config>) {
    const W = cfg.laneW;
    const H = cfg.laneH;
    this.rig.name = 'PlayRig';
    this.environment.name = 'Environment';

    // --- environment: sky dome, ground, two lights (no shadows) ---
    const skyGeo = new SphereGeometry(60, 24, 12);
    const pos = skyGeo.getAttribute('position');
    const colors: number[] = [];
    const c = new Color();
    for (let i = 0; i < pos.count; i++) {
      const t = Math.max(0, pos.getY(i) / 60);
      c.copy(SKY_HORIZON).lerp(SKY_TOP, Math.pow(t, 0.6));
      colors.push(c.r, c.g, c.b);
    }
    skyGeo.setAttribute('color', new Float32BufferAttribute(colors, 3));
    const sky = new Mesh(
      skyGeo,
      new MeshBasicMaterial({ vertexColors: true, side: BackSide, depthWrite: false, fog: false }),
    );
    sky.name = 'SkyDome';
    sky.renderOrder = -10;

    this.ground = new Mesh(
      new CircleGeometry(40, 32),
      new MeshLambertMaterial({ color: '#e3c38f' }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.name = 'Ground';

    const hemi = new HemisphereLight('#ffffff', '#c9a46b', 1.6);
    const sun = new DirectionalLight('#ffffff', 1.2);
    sun.position.set(-2, 5, 4);
    this.environment.add(sky, this.ground, hemi, sun);

    // --- rig: lane background and frame ---
    const laneBg = new Mesh(new PlaneGeometry(W, H), new MeshBasicMaterial({ color: '#d4eefb' }));
    laneBg.position.z = Z.laneBg;
    laneBg.name = 'Lane';

    const border = 0.06;
    const outer = new Shape();
    outer.moveTo(-W / 2 - border, -H / 2 - border * 2);
    outer.lineTo(W / 2 + border, -H / 2 - border * 2);
    outer.lineTo(W / 2 + border, H / 2 + border);
    outer.lineTo(-W / 2 - border, H / 2 + border);
    outer.closePath();
    const hole = new Shape();
    hole.moveTo(-W / 2, -H / 2);
    hole.lineTo(-W / 2, H / 2);
    hole.lineTo(W / 2, H / 2);
    hole.lineTo(W / 2, -H / 2);
    hole.closePath();
    outer.holes.push(hole);
    const frame = new Mesh(new ShapeGeometry(outer), new MeshBasicMaterial({ color: '#2b3a55' }));
    frame.position.z = Z.frame + 0.13; // in front of obstacle faces so edges look clean
    frame.name = 'Frame';

    // --- bird: placeholder sphere (the Joud model replaces it in prompt 03) ---
    this.bird = new Mesh(
      new SphereGeometry(cfg.birdRadius, 24, 16),
      new MeshLambertMaterial({ color: '#f28c28', emissive: '#000000' }),
    );
    this.bird.name = 'Bird';
    this.bird.position.set(cfg.birdX, 0, Z.bird);

    // --- obstacles: 5 pairs, one shared unit box, scaled per frame ---
    const box = new BoxGeometry(1, 1, 0.2);
    const obstacleMat = new MeshLambertMaterial({ color: '#2f8f6b' });
    for (let i = 0; i < POOL_SIZE; i++) {
      const pair: Mesh[] = [];
      for (let j = 0; j < 2; j++) {
        const m = new Mesh(box, obstacleMat);
        m.name = `Obstacle${i}${j === 0 ? 'Top' : 'Bottom'}`;
        m.visible = false;
        m.matrixAutoUpdate = true;
        pair.push(m);
        this.rig.add(m);
      }
      this.obstacleMeshes.push(pair);
    }

    // --- panels (canvas textures) ---
    this.attract = new CanvasPanel(1.6, 0.8, 1024, 512, 'AttractPanel');
    this.gameOver = new CanvasPanel(1.6, 0.8, 1024, 512, 'GameOverPanel');
    this.paused = new CanvasPanel(1.2, 0.4, 768, 256, 'PausedPanel');
    this.ready = new CanvasPanel(1.4, 0.18, 1024, 128, 'ReadyHint');
    this.score = new CanvasPanel(0.4, 0.2, 256, 128, 'Score');
    this.recentre = new CanvasPanel(0.6, 0.18, 512, 160, 'RecentreButton');
    this.hud = new CanvasPanel(0.9, 0.45, 512, 256, 'DebugHUD');

    this.attract.mesh.position.set(0, 0.05, Z.panel);
    this.gameOver.mesh.position.set(0, 0.05, Z.panel);
    this.paused.mesh.position.set(0, 0, Z.panel);
    this.ready.mesh.position.set(0, -H / 2 - 0.22, Z.panel);
    this.score.mesh.position.set(0, H / 2 + 0.18, Z.panel);
    this.recentre.mesh.position.set(0, -H / 2 - 0.22, Z.button);
    this.hud.mesh.position.set(-W / 2 - 0.5, H / 2 - 0.1, Z.panel);
    this.hud.mesh.rotation.y = 20 * DEG;

    this.rig.add(laneBg, frame, this.bird);
    for (const p of [this.attract, this.gameOver, this.paused, this.ready, this.score, this.hud]) {
      this.rig.add(p.mesh);
      p.visible = false;
    }
    // Mode buttons in reading order right to left: سهل · عادي · صعب.
    const modeX: Record<Mode, number> = { easy: 0.5, normal: 0, hard: -0.5 };
    const buttons = {} as Record<Mode, CanvasPanel>;
    for (const m of MODES) {
      const b = new CanvasPanel(0.46, 0.22, 512, 256, `ModeButton-${m}`);
      b.mesh.position.set(modeX[m], -0.53, Z.button);
      b.visible = false;
      buttons[m] = b;
    }
    this.modeButtons = buttons;

    // The recentre and mode buttons are parented by the shell: in IWSDK each
    // needs its own entity (RayInteractable).
    this.recentre.visible = false;
  }

  /**
   * Place the rig `dist` metres ahead of the head along the horizontal gaze,
   * at eye height + h, facing the player. Also drops the ground below.
   */
  place(headPos: Vector3, headQuat: Quaternion, dist = this.cfg.rigDistance): void {
    const f = this.tmpFwd.set(0, 0, -1).applyQuaternion(headQuat);
    f.y = 0;
    if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
    f.normalize();
    this.rig.position.set(
      headPos.x + f.x * dist,
      headPos.y + this.cfg.rigHeight,
      headPos.z + f.z * dist,
    );
    this.rig.rotation.set(0, Math.atan2(-f.x, -f.z), 0);
    // local-floor puts the floor at y=0; with `local`, y=0 is the head, so guess a seated floor.
    this.ground.position.y = headPos.y > 0.6 ? 0 : headPos.y - 1.2;
  }

  /**
   * Desktop: place the rig in front of a fixed camera, far enough that the
   * lane plus the score and hint rows fit the window.
   */
  placeForCamera(cam: PerspectiveCamera): void {
    cam.updateMatrixWorld(true);
    cam.getWorldPosition(this.tmpPos);
    cam.getWorldQuaternion(this.tmpQuat);
    const tanV = Math.tan((cam.fov * Math.PI) / 360);
    const tanH = tanV * cam.aspect;
    const fitH = (this.cfg.laneH + 0.9) / (2 * tanV);
    const fitW = (this.cfg.laneW + 0.3) / (2 * tanH);
    this.place(this.tmpPos, this.tmpQuat, Math.max(fitH, fitW));
  }

  onFlap(): void {
    this.squash = 1;
  }

  onHit(): void {
    this.flash = 1;
  }

  /** Copy core state to meshes. `dt` drives cosmetic animation only. */
  sync(game: Game, dt: number, time: number): void {
    const cfg = this.cfg;
    const halfW = cfg.laneW / 2;
    const halfH = cfg.laneH / 2;
    const halfP = cfg.pipeWidth / 2;

    // Obstacles: trim each block to the window so nothing shows outside it.
    const pool = game.field.pool;
    for (let i = 0; i < pool.length; i++) {
      const o = pool[i];
      const [top, bottom] = this.obstacleMeshes[i];
      const x0 = Math.max(o.x - halfP, -halfW);
      const x1 = Math.min(o.x + halfP, halfW);
      const show = o.active && x1 - x0 > 0.001;
      top.visible = show;
      bottom.visible = show;
      if (!show) continue;
      const cx = (x0 + x1) / 2;
      const w = x1 - x0;
      const gapTop = o.gapY + o.gap / 2;
      const gapBottom = o.gapY - o.gap / 2;
      top.position.set(cx, (gapTop + halfH) / 2, Z.obstacle);
      top.scale.set(w, Math.max(0.001, halfH - gapTop), 1);
      bottom.position.set(cx, (gapBottom - halfH) / 2, Z.obstacle);
      bottom.scale.set(w, Math.max(0.001, gapBottom + halfH), 1);
    }

    // Bird: bob while waiting, squash on flap, tilt with vertical speed, flash on hit.
    const idle = game.state === 'attract' || game.state === 'ready';
    const bob = idle ? Math.sin(time * 3) * 0.04 : 0;
    this.bird.position.y = game.bird.y + bob;
    this.squash = Math.max(0, this.squash - dt * 8);
    const s = 1 - 0.18 * this.squash;
    this.bird.scale.set(1 + 0.1 * this.squash, s, 1 + 0.1 * this.squash);
    const tilt = Math.max(-1, Math.min(1, game.bird.vy / game.cfg.flapVelocity));
    // Facing left (−x): nose up is a clockwise turn seen from the player.
    this.bird.rotation.z = game.state === 'playing' ? -tilt * 30 * DEG : 0;
    this.flash = Math.max(0, this.flash - dt * 2.5);
    const on = this.flash > 0 && Math.floor(this.flash * 10) % 2 === 0;
    this.bird.material.emissive.setScalar(on ? 0.8 : 0);
  }
}
