// Score juice: a small pooled burst of petal-coloured four-point sparkles.
// One InstancedMesh (one draw call), fixed pool, no allocation per frame.
// Particles shrink to nothing instead of fading: no transparency, no flashing.

import {
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { BRAND } from './scenery';

export const BURST_POOL = 64;
const PER_POINT = 10;
const LIFE = 0.75;
const GRAVITY = -1.4;

/** Four-point star in the XY plane, unit radius (8 triangles). */
function starGeometry(): BufferGeometry {
  const w = 0.3;
  const pts = [
    [0, 1], [w, w], [1, 0], [w, -w], [0, -1], [-w, -w], [-1, 0], [-w, w],
  ];
  const pos: number[] = [];
  for (let i = 0; i < 8; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % 8];
    pos.push(0, 0, 0, ax, ay, 0, bx, by, 0);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  return g;
}

const COLORS = [BRAND.rose, BRAND.redOrange, BRAND.butter, BRAND.sky, BRAND.cream, BRAND.orange].map(
  (c) => new Color(c),
);

export class ScoreBurst {
  readonly mesh: InstancedMesh;
  private readonly px = new Float32Array(BURST_POOL);
  private readonly py = new Float32Array(BURST_POOL);
  private readonly vx = new Float32Array(BURST_POOL);
  private readonly vy = new Float32Array(BURST_POOL);
  private readonly rot = new Float32Array(BURST_POOL);
  private readonly spin = new Float32Array(BURST_POOL);
  private readonly size = new Float32Array(BURST_POOL);
  private readonly life = new Float32Array(BURST_POOL); // seconds left, 0 = free
  private next = 0;
  private prevCount = 0;
  private readonly m = new Matrix4();
  private readonly p = new Vector3();
  private readonly q = new Quaternion();
  private readonly s = new Vector3();
  private readonly zAxis = new Vector3(0, 0, 1);

  constructor(private readonly z: number) {
    this.mesh = new InstancedMesh(
      starGeometry(),
      new MeshBasicMaterial({ color: '#ffffff', side: DoubleSide }),
      BURST_POOL,
    );
    this.mesh.name = 'ScoreBurst';
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    for (let i = 0; i < BURST_POOL; i++) this.mesh.setColorAt(i, COLORS[i % COLORS.length]);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  /** Spawn one point's burst at lane position (x, y). */
  spawn(x: number, y: number): void {
    for (let k = 0; k < PER_POINT; k++) {
      const i = this.next;
      this.next = (this.next + 1) % BURST_POOL;
      const a = (k / PER_POINT) * Math.PI * 2 + Math.random() * 0.5;
      const speed = 0.45 + Math.random() * 0.45;
      this.px[i] = x;
      this.py[i] = y;
      this.vx[i] = Math.cos(a) * speed;
      this.vy[i] = Math.sin(a) * speed + 0.35; // a little upward lift
      this.rot[i] = Math.random() * Math.PI;
      this.spin[i] = (Math.random() - 0.5) * 6;
      this.size[i] = 0.03 + Math.random() * 0.028;
      this.life[i] = LIFE;
    }
  }

  update(dt: number): void {
    let n = 0;
    for (let i = 0; i < BURST_POOL; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] = Math.max(0, this.life[i] - dt);
      this.vy[i] += GRAVITY * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.rot[i] += this.spin[i] * dt;
      if (this.life[i] <= 0) continue;
      const t = this.life[i] / LIFE; // 1 → 0
      const sc = this.size[i] * Math.min(1, t * 2.5) * (0.6 + 0.4 * t);
      this.p.set(this.px[i], this.py[i], this.z);
      this.q.setFromAxisAngle(this.zAxis, this.rot[i]);
      this.s.set(sc, sc, sc);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(n, this.m);
      // keep each live particle's colour with its slot
      this.mesh.setColorAt(n, COLORS[i % COLORS.length]);
      n++;
    }
    this.mesh.count = n;
    if (n > 0 || this.prevCount > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
    this.prevCount = n;
  }

  /** Live particles (for reports/tests). */
  get live(): number {
    let n = 0;
    for (let i = 0; i < BURST_POOL; i++) if (this.life[i] > 0) n++;
    return n;
  }
}
