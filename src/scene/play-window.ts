import {
  BackSide,
  BoxGeometry,
  CircleGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
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
import { Bird } from './bird';
import { CanvasPanel } from './canvas-panel';
import { setPanelFx } from './panel-art';
import { BRAND, buildFlowerStrip, buildFrameSparkles } from './scenery';

export interface ViewOptions {
  /** Visual effects on (?fx=0 turns them off). */
  fx: boolean;
}

// Campaign look (docs/joud-brand.md): soft blue sky down to butter yellow.
const SKY_TOP = new Color(BRAND.sky).lerp(new Color('#ffffff'), 0.45);
const SKY_HORIZON = new Color(BRAND.butter);
const LANE_BG = new Color(BRAND.sky).lerp(new Color('#ffffff'), 0.72);
const BOX_COLORS = [new Color(BRAND.butter), new Color(BRAND.deepGreen), new Color(BRAND.redOrange)];
const DEG = Math.PI / 180;

/** Stacked campaign boxes (100 × 50 cm ratio): one box is this tall in the lane. */
const BOX_H = 0.18;
const BOX_SEAM = 0.012;
const BOX_DEPTH = 0.12;
const MAX_BOXES = 56;

/** Depths in rig space (+Z faces the player). */
const Z = {
  // just behind the obstacle backs (−BOX_DEPTH/2), so no sky shows between them
  laneBg: -BOX_DEPTH / 2 - 0.01,
  frame: 0.0,
  bird: 0,
  obstacle: 0,
  panel: 0.18,
  button: 0.2,
};
/** Panels sit left of centre so Joud peeks out beside them. */
const PANEL_X = -0.2;

/**
 * Everything the player sees. `environment` is world-fixed (sky, ground,
 * lights, flower strip); `rig` is the PlayRig placed once per player.
 * Lane coordinates: x right, y up, origin at the lane centre, inside `rig`.
 */
export class PlayWindow {
  readonly environment = new Group();
  readonly rig = new Group();
  readonly ground: Mesh;
  readonly flowers: Mesh;
  readonly sparkles: Mesh;
  readonly bird: Bird;
  /** All obstacle blocks as stacked boxes in one instanced draw call. */
  readonly boxes: InstancedMesh;
  readonly attract: CanvasPanel;
  readonly ready: CanvasPanel;
  readonly gameOver: CanvasPanel;
  readonly paused: CanvasPanel;
  readonly score: CanvasPanel;
  readonly recentre: CanvasPanel;
  readonly hud: CanvasPanel;
  /** Mode picker buttons (Attract screen). Parented by the shell. */
  readonly modeButtons: Record<Mode, CanvasPanel>;
  /** Mute toggle (Attract screen), left of the mode buttons. Parented by the shell. */
  readonly muteButton: CanvasPanel;

  private readonly tmpFwd = new Vector3();
  private readonly tmpPos = new Vector3();
  private readonly tmpQuat = new Quaternion();
  private readonly boxMat = new Matrix4();
  private readonly boxPos = new Vector3();
  private readonly boxScale = new Vector3();
  private readonly noRot = new Quaternion();

  constructor(
    private readonly cfg: Readonly<Config>,
    readonly opts: ViewOptions = { fx: true },
  ) {
    const W = cfg.laneW;
    const H = cfg.laneH;
    this.rig.name = 'PlayRig';
    this.environment.name = 'Environment';
    setPanelFx(opts.fx);

    // --- environment: sky dome, ground, flower strip, two lights (no shadows) ---
    const skyGeo = new SphereGeometry(60, 24, 12);
    const pos = skyGeo.getAttribute('position');
    const colors: number[] = [];
    const c = new Color();
    for (let i = 0; i < pos.count; i++) {
      const t = Math.max(0, pos.getY(i) / 60);
      c.copy(SKY_HORIZON).lerp(SKY_TOP, Math.pow(t, 0.55));
      colors.push(c.r, c.g, c.b);
    }
    skyGeo.setAttribute('color', new Float32BufferAttribute(colors, 3));
    const sky = new Mesh(
      skyGeo,
      new MeshBasicMaterial({ vertexColors: true, side: BackSide, depthWrite: false, fog: false }),
    );
    sky.name = 'SkyDome';
    sky.renderOrder = -10;

    this.ground = new Mesh(new CircleGeometry(40, 32), new MeshLambertMaterial({ color: BRAND.leafGreen }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.name = 'Ground';

    // Painted flowers and leaves: one merged, unlit mesh, placed under the window in place().
    this.flowers = new Mesh(
      buildFlowerStrip(6.4, 0.26),
      new MeshBasicMaterial({ vertexColors: true, side: DoubleSide }),
    );
    this.flowers.name = 'FlowerStrip';

    // Warm cream bounce so Joud stays cream (a green ground colour tints the body).
    const hemi = new HemisphereLight('#ffffff', '#EADBC8', 1.6);
    const sun = new DirectionalLight('#ffffff', 1.2);
    sun.position.set(-2, 5, 4);
    this.environment.add(sky, this.ground, this.flowers, hemi, sun);

    // --- rig: lane background (frame-sized so the frame always covers its edge) and frame ---
    const border = 0.06;
    const laneBg = new Mesh(
      new PlaneGeometry(W + border * 2, H + border * 3),
      new MeshBasicMaterial({ color: LANE_BG }),
    );
    laneBg.position.set(0, -border / 2, Z.laneBg);
    laneBg.name = 'Lane';

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
    const frame = new Mesh(new ShapeGeometry(outer), new MeshBasicMaterial({ color: BRAND.deepGreen }));
    frame.position.z = Z.frame + BOX_DEPTH / 2 + 0.01; // just in front of the box faces
    frame.name = 'Frame';

    this.sparkles = new Mesh(
      buildFrameSparkles(W, H, frame.position.z + 0.002),
      new MeshBasicMaterial({ vertexColors: true, side: DoubleSide }),
    );
    this.sparkles.name = 'FrameSparkles';
    this.sparkles.visible = opts.fx;

    // --- bird: placeholder Joud until the GLB loads (src/scene/bird.ts) ---
    this.bird = new Bird(opts.fx);
    this.bird.root.position.set(cfg.birdX, 0, Z.bird);

    // --- obstacles: stacked campaign boxes, one InstancedMesh for the whole pool ---
    // Unlit, so the front faces show the exact campaign colours; fixed per-face
    // shades keep the stacks reading as boxes (vertex colour × instance colour).
    const boxGeo = new BoxGeometry(1, 1, BOX_DEPTH);
    const FACE_SHADE = [0.8, 0.8, 0.9, 0.7, 1, 0.7]; // +x −x +y −y +z −z
    const shade = new Float32Array(boxGeo.getAttribute('position').count * 3);
    for (let v = 0; v < shade.length / 3; v++) shade.fill(FACE_SHADE[Math.floor(v / 4)], v * 3, v * 3 + 3);
    boxGeo.setAttribute('color', new Float32BufferAttribute(shade, 3));
    this.boxes = new InstancedMesh(boxGeo, new MeshBasicMaterial({ vertexColors: true }), MAX_BOXES);
    this.boxes.name = 'ObstacleBoxes';
    this.boxes.instanceMatrix.setUsage(DynamicDrawUsage);
    for (let i = 0; i < MAX_BOXES; i++) this.boxes.setColorAt(i, BOX_COLORS[0]);
    this.boxes.count = 0;
    this.boxes.frustumCulled = false; // instances move every frame

    // --- panels (canvas textures) ---
    this.attract = new CanvasPanel(1.4, 0.7, 1024, 512, 'AttractPanel');
    this.gameOver = new CanvasPanel(1.4, 0.7, 1024, 512, 'GameOverPanel');
    this.paused = new CanvasPanel(1.1, 0.37, 768, 256, 'PausedPanel');
    this.ready = new CanvasPanel(1.4, 0.18, 1024, 128, 'ReadyHint');
    this.score = new CanvasPanel(0.4, 0.2, 256, 128, 'Score');
    this.recentre = new CanvasPanel(0.6, 0.18, 512, 160, 'RecentreButton');
    this.hud = new CanvasPanel(0.9, 0.45, 512, 256, 'DebugHUD');

    this.attract.mesh.position.set(PANEL_X, 0.1, Z.panel);
    this.gameOver.mesh.position.set(PANEL_X, 0.1, Z.panel);
    this.paused.mesh.position.set(PANEL_X, 0, Z.panel);
    this.ready.mesh.position.set(0, -H / 2 - 0.22, Z.panel);
    this.score.mesh.position.set(0, H / 2 + 0.18, Z.panel);
    this.recentre.mesh.position.set(0, -H / 2 - 0.22, Z.button);
    this.hud.mesh.position.set(-W / 2 - 0.5, H / 2 - 0.1, Z.panel);
    this.hud.mesh.rotation.y = 20 * DEG;

    this.rig.add(laneBg, frame, this.sparkles, this.boxes, this.bird.root);
    for (const p of [this.attract, this.gameOver, this.paused, this.ready, this.score, this.hud]) {
      this.rig.add(p.mesh);
      p.visible = false;
    }
    // Mode buttons in reading order right to left: سهل · عادي · صعب.
    const modeX: Record<Mode, number> = { easy: PANEL_X + 0.47, normal: PANEL_X, hard: PANEL_X - 0.47 };
    const buttons = {} as Record<Mode, CanvasPanel>;
    for (const m of MODES) {
      const b = new CanvasPanel(0.42, 0.2, 512, 256, `ModeButton-${m}`);
      b.mesh.position.set(modeX[m], -0.42, Z.button);
      b.visible = false;
      buttons[m] = b;
    }
    this.modeButtons = buttons;
    this.muteButton = new CanvasPanel(0.36, 0.2, 512, 288, 'MuteButton');
    this.muteButton.mesh.position.set(modeX.hard - 0.45, -0.42, Z.button);
    this.muteButton.visible = false;

    // The recentre and mode buttons are parented by the shell: in IWSDK each
    // needs its own entity (RayInteractable).
    this.recentre.visible = false;
  }

  /**
   * Place the rig `dist` metres ahead of the head along the horizontal gaze,
   * at eye height + h, facing the player. Also drops the ground and the
   * flower strip below the window.
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
    const yaw = Math.atan2(-f.x, -f.z);
    this.rig.rotation.set(0, yaw, 0);
    // local-floor puts the floor at y=0; with `local`, y=0 is the head, so guess a seated floor.
    const groundY = headPos.y > 0.6 ? 0 : headPos.y - 1.2;
    this.ground.position.y = groundY;
    this.flowers.position.set(this.rig.position.x, groundY + 0.002, this.rig.position.z);
    this.flowers.rotation.set(0, yaw, 0);
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
    this.bird.onFlap();
  }

  onHit(): void {
    this.bird.onHit();
  }

  /** Copy core state to meshes. `dt` drives cosmetic animation only. */
  sync(game: Game, dt: number, time: number): void {
    const cfg = this.cfg;
    const halfW = cfg.laneW / 2;
    const halfH = cfg.laneH / 2;
    const halfP = cfg.pipeWidth / 2;

    // Obstacles: stack boxes from each gap edge out to the lane edge, trimmed
    // horizontally to the window so nothing shows outside it.
    let n = 0;
    const pool = game.field.pool;
    for (let i = 0; i < pool.length && i < POOL_SIZE; i++) {
      const o = pool[i];
      if (!o.active) continue;
      const x0 = Math.max(o.x - halfP, -halfW);
      const x1 = Math.min(o.x + halfP, halfW);
      if (x1 - x0 <= 0.001) continue;
      const cx = (x0 + x1) / 2;
      const w = x1 - x0;
      n = this.stack(n, i, 0, cx, w, o.gapY + o.gap / 2, halfH, 1);
      n = this.stack(n, i, 1, cx, w, o.gapY - o.gap / 2, -halfH, -1);
    }
    this.boxes.count = n;
    this.boxes.instanceMatrix.needsUpdate = true;
    if (this.boxes.instanceColor) this.boxes.instanceColor.needsUpdate = true;

    this.bird.update(game, dt, time);
  }

  /** Boxes from `from` (gap edge) towards `to` (lane edge), `dir` = ±1. */
  private stack(n: number, slot: number, side: number, cx: number, w: number, from: number, to: number, dir: 1 | -1): number {
    let y = from;
    let k = 0;
    while ((to - y) * dir > 0.002 && n < MAX_BOXES) {
      const h = Math.min(BOX_H, (to - y) * dir);
      const visibleH = h > BOX_SEAM * 2 ? h - BOX_SEAM : h;
      this.boxPos.set(cx, y + (dir * visibleH) / 2, Z.obstacle);
      this.boxScale.set(w, visibleH, 1);
      this.boxMat.compose(this.boxPos, this.noRot, this.boxScale);
      this.boxes.setMatrixAt(n, this.boxMat);
      this.boxes.setColorAt(n, BOX_COLORS[(slot + side + k) % 3]);
      y += dir * h;
      k++;
      n++;
    }
    return n;
  }
}
