// Campaign-look scenery (docs/joud-brand.md): flat painted-style flowers and
// leaves, four-point sparkles. Everything is merged into single meshes with
// vertex colours (one draw call each), built once with a fixed seed.

import { type BufferGeometry, Color, Float32BufferAttribute, BufferGeometry as Geo } from 'three';

/** Campaign artwork colours (joud-brand.md → Colour). */
export const BRAND = {
  butter: '#F8E888',
  sky: '#5898D8',
  redOrange: '#E84818',
  deepGreen: '#085828',
  leafGreen: '#288858',
  rose: '#D87888',
  orange: '#E88848',
  cream: '#F8E8C8',
  peach: '#F8B898',
  brick: '#981808',
};

/** Accumulates flat coloured triangles, then makes one geometry. */
class FlatBuilder {
  private readonly pos: number[] = [];
  private readonly col: number[] = [];
  private readonly c = new Color();

  tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, color: string): void {
    this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    this.c.set(color);
    for (let i = 0; i < 3; i++) this.col.push(this.c.r, this.c.g, this.c.b);
  }

  /** Ellipse fan in the XY plane facing +Z, rotated by `rot` about Z. */
  ellipse(x: number, y: number, z: number, rx: number, ry: number, rot: number, color: string, seg = 6): void {
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const p0x = Math.cos(a0) * rx;
      const p0y = Math.sin(a0) * ry;
      const p1x = Math.cos(a1) * rx;
      const p1y = Math.sin(a1) * ry;
      this.tri(
        x, y, z,
        x + p0x * cr - p0y * sr, y + p0x * sr + p0y * cr, z,
        x + p1x * cr - p1y * sr, y + p1x * sr + p1y * cr, z,
        color,
      );
    }
  }

  /** Axis-aligned quad in the XY plane. */
  quad(x0: number, y0: number, x1: number, y1: number, z: number, color: string): void {
    this.tri(x0, y0, z, x1, y0, z, x1, y1, z, color);
    this.tri(x0, y0, z, x1, y1, z, x0, y1, z, color);
  }

  /** Four-point star (sparkle) in the XY plane: 8 triangles. */
  sparkle(x: number, y: number, z: number, r: number, color: string): void {
    const w = r * 0.28;
    const pts: [number, number][] = [
      [0, r], [w, w], [r, 0], [w, -w], [0, -r], [-w, -w], [-r, 0], [-w, w],
    ];
    for (let i = 0; i < 8; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % 8];
      this.tri(x, y, z, x + ax, y + ay, z, x + bx, y + by, z, color);
    }
  }

  build(): BufferGeometry {
    const g = new Geo();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/** Deterministic PRNG so the strip looks the same every load. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Ground strip of painted flowers and leaves, standing as flat cut-outs on
 * the ground under and around the play window. Local space: x along the
 * window, y up from the ground, z towards the player. Low enough (≤ 0.3 m)
 * to stay below the window.
 */
export function buildFlowerStrip(width = 6.4, maxHeight = 0.3): BufferGeometry {
  const b = new FlatBuilder();
  const r = rng(1117);
  const petals = [BRAND.redOrange, BRAND.rose, BRAND.sky, BRAND.redOrange, BRAND.rose];
  const centres = [BRAND.orange, BRAND.butter];
  const leaves = [BRAND.leafGreen, BRAND.deepGreen];

  // leaf clumps first (behind), then flowers in front
  for (let i = 0; i < 46; i++) {
    const x = (r() - 0.5) * width;
    const z = -0.5 + r() * 0.9;
    const h = (0.35 + r() * 0.65) * maxHeight * 0.8;
    const col = leaves[i % 2];
    for (const k of [-0.5, 0, 0.5]) {
      const rot = Math.PI / 2 + k * 0.9 + (r() - 0.5) * 0.3;
      const len = h * (k === 0 ? 1 : 0.75);
      b.ellipse(x + Math.cos(rot) * len * 0.5, Math.sin(rot) * len * 0.5, z, len * 0.5, len * 0.14, rot, col, 6);
    }
  }
  for (let i = 0; i < 70; i++) {
    const x = (r() - 0.5) * width;
    const z = -0.45 + r() * 0.85 + 0.01;
    const h = (0.4 + r() * 0.6) * maxHeight;
    const size = 0.035 + r() * 0.035;
    b.quad(x - 0.006, 0, x + 0.006, h, z - 0.002, BRAND.deepGreen); // stem
    b.ellipse(x - size * 0.9, h * 0.45, z - 0.001, size * 0.9, size * 0.32, 0.5, BRAND.leafGreen, 6);
    const pc = petals[Math.floor(r() * petals.length)];
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * Math.PI * 2 + r() * 0.2;
      b.ellipse(x + Math.cos(a) * size * 0.75, h + Math.sin(a) * size * 0.75, z, size * 0.62, size * 0.38, a, pc, 6);
    }
    b.ellipse(x, h, z + 0.001, size * 0.42, size * 0.42, 0, centres[i % 2], 6);
  }
  return b.build();
}

/**
 * Small four-point sparkles around the play window frame (rig space).
 * Static accents in the campaign colours; hidden with ?fx=0.
 */
export function buildFrameSparkles(laneW: number, laneH: number, z: number): BufferGeometry {
  const b = new FlatBuilder();
  const spots: [number, number, number, string][] = [
    [-laneW / 2 - 0.16, laneH / 2 + 0.12, 0.06, BRAND.butter],
    [-laneW / 2 - 0.3, laneH / 2 - 0.2, 0.035, BRAND.cream],
    [laneW / 2 + 0.18, laneH / 2 + 0.08, 0.05, BRAND.rose],
    [laneW / 2 + 0.3, laneH / 2 - 0.35, 0.035, BRAND.butter],
    [laneW / 2 + 0.2, -laneH / 2 + 0.1, 0.045, BRAND.cream],
    [-laneW / 2 - 0.22, -laneH / 2 + 0.25, 0.045, BRAND.rose],
    [0.55, laneH / 2 + 0.2, 0.03, BRAND.butter],
    [-0.6, laneH / 2 + 0.16, 0.035, BRAND.cream],
  ];
  for (const [x, y, s, c] of spots) b.sparkle(x, y, z, s, c);
  return b.build();
}
