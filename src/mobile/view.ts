// Three.js view of the portrait lane. Reads core state only; never changes it.
// Plain `three` (the same super-three), no IWSDK, no WebXR. Budget: < 50 draw calls,
// Lambert/Basic materials, no shadows or post-processing.

import {
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Config } from '../core/config';
import type { Game } from '../core/game';
import type { ObstacleKind, PointsTable } from '../core/ruleset';
import { Bird } from '../scene/bird';
import { BRAND, buildFlowerStrip } from '../scene/scenery';
import {
  buildFacade,
  buildPlazaRow,
  FAR_PARALLAX,
  FAR_TILE_M,
  FAR_METRE,
  layerOffset,
  NEAR_METRE,
  NEAR_PARALLAX,
  NEAR_TILE_M,
} from './backdrop';
import { ScoreBurst } from '../scene/burst';
import { boxTile, type Column, drawBoxAtlas, tileRect, wordColumn } from './box-art';
import { badgeKey, badgeRect, type Cue, cueFor, drawBadgeAtlas, SPARKLE_TILE } from './cues';

export interface ViewOptions {
  /** Load joud.glb (false: the code-built placeholder bird). */
  model: boolean;
  glbUrl: string;
  /** Decorative effects (flower spin, updraft motion, backdrop parallax). */
  fx: boolean;
  /** Flower strip under the lane and the near backdrop layer. */
  scenery: boolean;
  /** Box-face atlas resolution: 1 (default), or 0.5 on the low tier. */
  atlasScale?: number;
  /** The ruleset's points table: badges show exactly what a gap pays. */
  points: Readonly<PointsTable>;
}

const BOX_H = 0.06;
const BOX_SEAM = 0.004;
const MAX_BOXES = 640;

const MAX_BADGES = 24;
const BADGE_SIZE = 0.068;
const LIP_SPARKLE = 0.034;
/** VR burst sizes are for a 2.8 m window; the phone lane is 1.0 wide. */
const BURST_SCALE = 0.6;

/**
 * Flat, unlit material showing one atlas tile per instance: `aTile` = (u0, v0, width, height)
 * replaces the plane's 0–1 UVs. Exact brand colours, one draw call per mesh. `alphaTest`
 * gives round cut-outs without blending.
 */
function atlasMaterial(canvas: HTMLCanvasElement, alphaTest = 0): MeshBasicMaterial {
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 2;
  const mat = new MeshBasicMaterial({ map: tex, alphaTest });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'attribute vec4 aTile;\nvoid main() {')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvMapUv = aTile.xy + uv * aTile.zw;');
  };
  return mat;
}

/** Instanced unit planes with a per-instance atlas tile. */
function tiledPlanes(material: MeshBasicMaterial, max: number): { mesh: InstancedMesh; tiles: InstancedBufferAttribute } {
  const geo = new PlaneGeometry(1, 1);
  const tiles = new InstancedBufferAttribute(new Float32Array(max * 4), 4);
  tiles.setUsage(DynamicDrawUsage);
  geo.setAttribute('aTile', tiles);
  const mesh = new InstancedMesh(geo, material, max);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  return { mesh, tiles };
}
/** Ground and flowers visible under the lane. */
const GROUND_MARGIN = 0.22;
/** The Bird model's body radius is ≈ 0.12 at its own scale. */
const BIRD_MODEL_RADIUS = 0.12;
const STRIPES_PER_UPDRAFT = 12;
const MAX_STRIPES = 16 * STRIPES_PER_UPDRAFT;
const MAX_FLOWERS = 16;

/** Five round petals and a centre, flat, vertex coloured (radius ≈ 1). */
function flowerGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const add = (cx: number, cy: number, r: number, color: string, z: number) => {
    const pos: number[] = [];
    const col: number[] = [];
    const c = new Color(color);
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      pos.push(cx, cy, z, cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, z, cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, z);
      for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    parts.push(g);
  };
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + Math.PI / 2;
    add(Math.cos(a) * 0.55, Math.sin(a) * 0.55, 0.5, BRAND.rose, 0);
  }
  add(0, 0, 0.38, BRAND.butter, 0.01);
  return mergeGeometries(parts)!;
}

/** Vertical gradient plane (sky). */
function gradientPlane(w: number, h: number, top: Color, bottom: Color): Mesh {
  const g = new PlaneGeometry(w, h, 1, 1);
  const col: number[] = [];
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const c = pos.getY(i) > 0 ? top : bottom;
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  return new Mesh(g, new MeshBasicMaterial({ vertexColors: true }));
}

export class MobileView {
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-0.5, 0.5, 1, -1, 0.1, 20);
  readonly bird: Bird;
  private readonly birdHolder = new Group();
  private readonly boxes: InstancedMesh;
  /** Per-box atlas tile rectangle (u0, v0, width, height). */
  private readonly boxTiles: InstancedBufferAttribute;
  private readonly badges: InstancedMesh;
  private readonly badgeRects: InstancedBufferAttribute;
  /** Badge-atlas tile per obstacle kind (no entry: no badge). Looked up per frame, no allocation. */
  private readonly kindTile = new Map<ObstacleKind, number>();
  private badgeCount = 0;
  private readonly burst: ScoreBurst;
  private readonly burstHolder = new Group();
  private readonly stripes: InstancedMesh;
  private readonly flowers: InstancedMesh;
  private readonly m = new Matrix4();
  /** Scratch tile rectangle (no allocation per frame). */
  private readonly rect: [number, number, number, number] = [0, 0, 0, 0];
  private readonly tmpScale = new Vector3();
  private cfg: Readonly<Config>;
  private fx: boolean;
  private strip: Mesh | null = null;
  private readonly facade: Mesh;
  private readonly plaza: Mesh;
  /** Backdrop scroll distance (lane units); render-only. */
  private scroll = 0;
  private glbWanted: boolean;

  // Interpolation: state before the last fixed step.
  private prevBirdY = 0;
  private prevX = new Float64Array(16);
  private prevGapY = new Float64Array(16);
  private prevGap2Y = new Float64Array(16);
  private prevFlowerY = new Float64Array(16);

  constructor(cfg: Readonly<Config>, opts: ViewOptions) {
    this.cfg = cfg;
    this.fx = opts.fx;
    const s = this.scene;
    s.background = new Color(BRAND.sky).lerp(new Color('#ffffff'), 0.55);

    const skyTop = new Color(BRAND.sky).lerp(new Color('#ffffff'), 0.45);
    const skyBottom = new Color(BRAND.butter).lerp(new Color('#ffffff'), 0.25);
    const sky = gradientPlane(8, cfg.laneH + 0.02, skyTop, skyBottom);
    sky.position.z = -2;
    s.add(sky);

    // The event plaza (src/mobile/backdrop.ts): façade far back, booths and palms nearer.
    const layerMat = new MeshBasicMaterial({ vertexColors: true });
    this.facade = new Mesh(buildFacade(), layerMat);
    this.facade.scale.set(FAR_METRE, FAR_METRE, 1);
    this.facade.position.set(0, -cfg.laneH / 2, -1.9);
    this.plaza = new Mesh(buildPlazaRow(), layerMat);
    this.plaza.scale.set(NEAR_METRE, NEAR_METRE, 1);
    this.plaza.position.set(0, -cfg.laneH / 2, -1.7);
    this.plaza.visible = opts.scenery;
    s.add(this.facade, this.plaza);

    const ground = new Mesh(new PlaneGeometry(8, 3), new MeshBasicMaterial({ color: BRAND.leafGreen }));
    ground.position.set(0, -cfg.laneH / 2 - 1.5, -1.5);
    s.add(ground);

    {
      // The VR strip is 0.3 tall at its own scale; here it fills the ground margin.
      const strip = new Mesh(buildFlowerStrip(2.4 / 0.45, 0.3), new MeshBasicMaterial({ vertexColors: true }));
      const k = (GROUND_MARGIN * 0.8) / 0.3;
      strip.scale.set(0.45 * k * 0.5, k * 0.5, 0.01);
      strip.position.set(0, -cfg.laneH / 2 - GROUND_MARGIN * 0.75, -1);
      strip.visible = opts.scenery;
      this.strip = strip;
      s.add(strip);
    }

    // Lights for the Lambert bird.
    s.add(new HemisphereLight('#ffffff', '#88aa77', 2.2));
    const sun = new DirectionalLight('#ffffff', 1.4);
    sun.position.set(-1, 2, 3);
    s.add(sun);

    // Campaign boxes: front faces only (the ortho camera never sees their sides).
    const boxes = tiledPlanes(atlasMaterial(drawBoxAtlas(opts.atlasScale ?? 1)), MAX_BOXES);
    this.boxes = boxes.mesh;
    this.boxTiles = boxes.tiles;
    s.add(this.boxes);

    // Cues: one badge per gap that pays more than a gate (src/mobile/cues.ts). Gameplay
    // information, so they stay on with effects off and on every tier.
    const kinds = ['stairs', 'updraft', 'narrow', 'moving', 'fork'] as const;
    const cues = kinds.map((kind) => cueFor({ kind }, opts.points)).filter((c): c is Cue => c !== null);
    const badgeAtlas = drawBadgeAtlas(cues);
    kinds.forEach((kind) => {
      const c = cueFor({ kind }, opts.points);
      const tile = c ? badgeAtlas.tiles.get(badgeKey(c)) : undefined;
      if (tile !== undefined) this.kindTile.set(kind, tile);
    });
    const badges = tiledPlanes(atlasMaterial(badgeAtlas.canvas, 0.5), MAX_BADGES);
    this.badges = badges.mesh;
    this.badgeRects = badges.tiles;
    this.badges.position.z = 0.1;
    s.add(this.badges);

    // Score juice: the VR petal/sparkle burst, scaled to the phone lane (effects only).
    this.burst = new ScoreBurst(0);
    this.burstHolder.scale.setScalar(BURST_SCALE);
    this.burstHolder.position.z = 0.6;
    this.burstHolder.visible = opts.fx;
    this.burstHolder.add(this.burst.mesh);
    s.add(this.burstHolder);

    const stripeColor = new Color(BRAND.butter).lerp(new Color('#ffffff'), 0.35);
    this.stripes = new InstancedMesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ color: stripeColor }),
      MAX_STRIPES,
    );
    this.stripes.instanceMatrix.setUsage(DynamicDrawUsage);
    this.stripes.frustumCulled = false;
    this.stripes.position.z = -0.3;
    s.add(this.stripes);

    this.flowers = new InstancedMesh(flowerGeometry(), new MeshBasicMaterial({ vertexColors: true }), MAX_FLOWERS);
    this.flowers.instanceMatrix.setUsage(DynamicDrawUsage);
    this.flowers.frustumCulled = false;
    this.flowers.position.z = 0.2;
    s.add(this.flowers);

    // Side masks: obstacles appear and leave behind them on screens wider than the lane.
    const maskMat = new MeshBasicMaterial({ color: BRAND.deepGreen });
    const left = new PlaneGeometry(4, 12).translate(-cfg.laneW / 2 - 2, 0, 0);
    const right = new PlaneGeometry(4, 12).translate(cfg.laneW / 2 + 2, 0, 0);
    const masks = new Mesh(mergeGeometries([left, right])!, maskMat);
    masks.position.z = 1;
    s.add(masks);

    this.bird = new Bird(opts.fx);
    this.birdHolder.add(this.bird.root);
    this.birdHolder.position.z = 0.5;
    s.add(this.birdHolder);
    this.setConfig(cfg);
    this.glbWanted = opts.model;
    if (opts.model) void this.bird.load(opts.glbUrl).then(() => this.setBirdDetail(this.glbWanted));

    this.camera.position.set(0, 0, 10);
  }

  // ---------- render tiers (src/mobile/perf.ts): rendering only, never the sim ----------

  setEffects(on: boolean): void {
    this.fx = on;
    this.burstHolder.visible = on;
  }

  setScenery(on: boolean): void {
    if (this.strip) this.strip.visible = on;
    this.plaza.visible = on;
  }

  /** joud.glb (if loaded) or the code-built placeholder. Glasses and legs stay. */
  setBirdDetail(glb: boolean): void {
    this.glbWanted = glb;
    if (this.bird.status !== 'joud') return;
    const model = this.bird.root.children[0];
    for (const child of model.children) {
      if (child.name === 'BirdGlassesLegs') continue;
      child.visible = child.name === 'BirdPlaceholder' ? !glb : glb;
    }
  }

  setConfig(cfg: Readonly<Config>): void {
    this.cfg = cfg;
    this.birdHolder.scale.setScalar(cfg.birdRadius / BIRD_MODEL_RADIUS);
  }

  /** Fit lane + ground into a w × h canvas (contain). */
  resize(w: number, h: number): void {
    const cfg = this.cfg;
    const aspect = w / Math.max(1, h);
    const needW = cfg.laneW;
    const needH = cfg.laneH + GROUND_MARGIN;
    let halfW: number;
    let halfH: number;
    if (aspect > needW / needH) {
      halfH = needH / 2;
      halfW = halfH * aspect;
    } else {
      halfW = needW / 2;
      halfH = halfW / aspect;
    }
    const cy = -GROUND_MARGIN / 2;
    const c = this.camera;
    c.left = -halfW;
    c.right = halfW;
    c.top = cy + halfH;
    c.bottom = cy - halfH;
    c.updateProjectionMatrix();
  }

  /** Called before every fixed step: remember the state for interpolation. */
  snapshot(game: Game): void {
    this.prevBirdY = game.bird.y;
    const pool = game.field.pool;
    if (pool.length > this.prevX.length) {
      this.prevX = new Float64Array(pool.length);
      this.prevGapY = new Float64Array(pool.length);
      this.prevGap2Y = new Float64Array(pool.length);
      this.prevFlowerY = new Float64Array(pool.length);
    }
    for (let i = 0; i < pool.length; i++) {
      this.prevX[i] = pool[i].x;
      this.prevGapY[i] = pool[i].gapY;
      this.prevGap2Y[i] = pool[i].gap2Y;
      this.prevFlowerY[i] = pool[i].flowerY;
    }
  }

  /** Forget the previous state (new round, unpause), so nothing streaks. */
  resetInterpolation(game: Game): void {
    this.snapshot(game);
  }

  private boxCount = 0;

  private pushBox(x: number, y: number, w: number, h: number, tile: number, keepTop: boolean): void {
    if (this.boxCount >= MAX_BOXES || h <= 0) return;
    this.m.makeScale(w, h, 1);
    this.m.setPosition(x, y, 0);
    this.boxes.setMatrixAt(this.boxCount, this.m);
    // A box cut short shows part of its face, never a squashed one.
    const r = tileRect(tile, h / (BOX_H - BOX_SEAM), keepTop, 4, this.rect);
    this.boxTiles.setXYZW(this.boxCount, r[0], r[1], r[2], r[3]);
    this.boxCount++;
  }

  private pushBadge(x: number, y: number, size: number, tile: number): void {
    if (this.badgeCount >= MAX_BADGES) return;
    this.m.makeScale(size, size, 1);
    this.m.setPosition(x, y, 0);
    this.badges.setMatrixAt(this.badgeCount, this.m);
    const r = badgeRect(tile, this.rect);
    this.badgeRects.setXYZW(this.badgeCount, r[0], r[1], r[2], r[3]);
    this.badgeCount++;
  }

  // ---------- score juice (effects only) ----------

  /** Burst at the bird when obstacle points land; a second one for 3 points or more. */
  onScore(game: Game, points: number): void {
    if (!this.fx) return;
    const x = game.cfg.birdX / BURST_SCALE;
    const y = game.bird.y / BURST_SCALE;
    this.burst.spawn(x, y);
    if (points >= 3) this.burst.spawn(x, y);
  }

  /** Burst where the flower was picked up (at the bird). */
  onFlower(game: Game): void {
    if (this.fx) this.burst.spawn(game.cfg.birdX / BURST_SCALE, game.bird.y / BURST_SCALE);
  }

  /** Stack campaign boxes from the gap edge `from` towards `to` (either direction), clipped at `to`. */
  private stack(x: number, w: number, from: number, to: number, slot: number, column: Column): void {
    const dir = to > from ? 1 : -1;
    const len = Math.abs(to - from);
    let k = 0;
    for (let d = 0; d < len; d += BOX_H) {
      const h = Math.min(BOX_H, len - d) - BOX_SEAM;
      const yc = from + dir * (d + (h + BOX_SEAM) / 2);
      // Stacking up, a cut box keeps its bottom (it runs on past the cut); stacking down, its top.
      this.pushBox(x, yc, w, h, boxTile(slot, k, column), dir < 0);
      k++;
    }
  }

  private lerp(a: number, b: number, t: number, jump: number): number {
    return Math.abs(b - a) > jump ? b : a + (b - a) * t;
  }

  sync(game: Game, dt: number, time: number): void {
    const cfg = game.cfg;
    const t = game.state === 'playing' ? Math.min(1, Math.max(0, game.alpha)) : 1;
    const top = cfg.laneH / 2;
    const half = cfg.pipeWidth / 2;

    // Bird (render-interpolated; idle bob outside a round).
    this.bird.update(game, dt, time);
    const idle = game.state === 'attract' || game.state === 'ready';
    const y = this.lerp(this.prevBirdY, game.bird.y, t, 0.5) + (idle ? Math.sin(time * 3) * 0.012 : 0);
    this.bird.root.position.set(0, 0, 0);
    this.birdHolder.position.set(cfg.birdX, y, 0.5);

    // Backdrop parallax: moves with the obstacles while playing, drifts on the home and ready
    // screens, holds still when paused or over. Static with effects off.
    if (this.fx) {
      const v = game.state === 'playing' ? game.speed : idle ? 0.06 : 0;
      this.scroll += v * dt;
    }
    this.facade.position.x = layerOffset(this.scroll, FAR_PARALLAX, FAR_TILE_M * FAR_METRE);
    this.plaza.position.x = layerOffset(this.scroll, NEAR_PARALLAX, NEAR_TILE_M * NEAR_METRE);

    // Obstacles.
    this.boxCount = 0;
    let stripes = 0;
    let flowers = 0;
    const pool = game.field.pool;
    for (let i = 0; i < pool.length; i++) {
      const o = pool[i];
      if (!o.active) continue;
      const x = this.lerp(this.prevX[i], o.x, t, 0.2);
      const gapY = this.lerp(this.prevGapY[i], o.gapY, t, 0.2);
      let upperY = gapY;
      let upper = o.gap;
      let lowerY = gapY;
      let lower = o.gap;
      if (o.gap2 > 0) {
        const g2 = this.lerp(this.prevGap2Y[i], o.gap2Y, t, 0.2);
        if (g2 > gapY) {
          upperY = g2;
          upper = o.gap2;
        } else {
          lowerY = g2;
          lower = o.gap2;
        }
        this.stack(x, cfg.pipeWidth, lowerY + lower / 2, upperY - upper / 2, i, 'middle');
      }
      this.stack(x, cfg.pipeWidth, upperY + upper / 2, top, i, 'upper');
      this.stack(x, cfg.pipeWidth, lowerY - lower / 2, -top, i, 'lower');

      // Capacities are constants: .count is lowered every frame to what is drawn.
      if (o.updraft > 0 && stripes + STRIPES_PER_UPDRAFT <= MAX_STRIPES) {
        const lead = x + half;
        for (let c = 0; c < 3; c++) {
          const sx = lead + (o.updraft * (c + 0.5)) / 3;
          for (let d = 0; d < 4; d++) {
            const phase = this.fx ? (time * 0.35 + d / 4 + c * 0.13) % 1 : d / 4 + c * 0.1;
            const sy = -top + phase * cfg.laneH;
            this.m.makeScale(0.006, 0.08, 1);
            this.m.setPosition(sx, sy, 0);
            this.stripes.setMatrixAt(stripes++, this.m);
          }
        }
      }

      if (o.flower === 1 && flowers < MAX_FLOWERS) {
        const fy = this.lerp(this.prevFlowerY[i], o.flowerY, t, 0.2);
        const r = game.ruleset.kinds.flowerRadius * 1.1;
        this.m.makeRotationZ(this.fx ? time * 1.5 : 0);
        this.m.scale(this.tmpScale.set(r, r, 1));
        this.m.setPosition(x, fy, 0);
        this.flowers.setMatrixAt(flowers++, this.m);
      }

      // Cue badge on a box next to the marked gap, until the obstacle is passed: on the side
      // without the words, and for a fork's risky gap on the middle block.
      const tile = this.kindTile.get(o.kind);
      if (tile !== undefined && !o.scored) {
        const risky = o.kind === 'fork' && o.gap2 > 0;
        const gy = risky ? this.lerp(this.prevGap2Y[i], o.gap2Y, t, 0.2) : gapY;
        const gh = risky ? o.gap2 : o.gap;
        const above = risky ? gy < gapY : wordColumn(i) === 'lower';
        this.pushBadge(x, above ? gy + gh / 2 + BOX_H / 2 : gy - gh / 2 - BOX_H / 2, BADGE_SIZE, tile);
        if (risky) {
          // Two sparkles at the lips the bird flies into (obstacles move towards +x).
          this.pushBadge(x + half, gy + gh / 2, LIP_SPARKLE, SPARKLE_TILE);
          this.pushBadge(x + half, gy - gh / 2, LIP_SPARKLE, SPARKLE_TILE);
        }
      }
    }
    this.badges.count = this.badgeCount;
    this.badges.instanceMatrix.needsUpdate = true;
    this.badgeRects.needsUpdate = true;
    this.badgeCount = 0;
    this.burst.update(dt);
    this.boxes.count = this.boxCount;
    this.boxes.instanceMatrix.needsUpdate = true;
    this.boxTiles.needsUpdate = true;
    this.stripes.count = stripes;
    this.stripes.instanceMatrix.needsUpdate = true;
    this.flowers.count = flowers;
    this.flowers.instanceMatrix.needsUpdate = true;
  }

  render(renderer: WebGLRenderer): void {
    renderer.render(this.scene, this.camera);
  }
}
