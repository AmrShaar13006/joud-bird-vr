// The plaza of the event (طلعتنا اليوم at Al Yamamah University) behind the phone lane, in
// Joud's flat campaign style: flat colour blocks, no gloss, no textures.
//
// Measurements come from the Talaatna booth planner's venue data (numbers only):
//   data/venue.json  → scene.buildings[main]: façade 13 m, plinth 0.45, parapet 0.35, three rows
//                      of paired windows (sills 1.1 / 5.45 / 9.8 m, 1.15 × 1.5 m, 0.5 m between
//                      the pair, one pair per 6.4 m bay), entrance portal 5.7 m wide, 0.4 m above
//                      the roof line; door recess 4.4 m.
//                    → scene.palm: trunk 4.8 m, crown at 5.25 m, 10 fronds 2.6 m long;
//                      G.palms: palms at 10.46 / 22.77 / 36.93 / 49.37 m along the plaza.
//   data/assets.json → booth: 3 m wide, 2.5 m posts, 0.36 m header, 2.8 × 1 m counter,
//                      0.7 m round sign 0.42 m in from the side, 0.22 m above the header.
// Signs are plain brand-colour discs: no participant or university logos. The string lights
// are decoration (the planner has no measurement for them).
//
// Two static meshes (one draw call each), built once. Rendering only: never touches the sim.

import { BufferGeometry, Color, Float32BufferAttribute } from 'three';
import { BRAND } from '../scene/scenery';

/**
 * Lane units per real metre. The far layer is drawn a little smaller than the near one, so
 * the flat layers still read as depth: the 13 m façade reaches about 0.54 of the 1.8 lane.
 */
export const FAR_METRE = 0.075;
export const NEAR_METRE = 0.085;
/** Façade tile: six 6.4 m bays (the portal takes one). */
export const FAR_TILE_M = 6 * 6.4;
/** Near tile: the four measured palms repeat every 52 m (spacing 12.3–14.2 m). */
export const NEAR_TILE_M = 52;
/** Parallax factors (× obstacle speed). */
export const FAR_PARALLAX = 0.15;
export const NEAR_PARALLAX = 0.4;

const PALMS_M = [10.46, 22.77, 36.93, 49.37];

/**
 * Warm light tone the backdrop fades towards, so obstacles stay the most saturated things on
 * screen. Fading to cream, not sky blue, keeps the greens green instead of grey.
 */
const HAZE = new Color(BRAND.cream).lerp(new Color('#ffffff'), 0.5);

const WHITE = new Color('#ffffff');

/**
 * The game's sky (game-backdrop.ts draws it behind the plaza as a vertical gradient): `bottom`
 * on the lane's floor, `top` at its roof.
 */
export function skyColors(): { top: Color; bottom: Color } {
  return {
    top: new Color(BRAND.sky).lerp(WHITE, 0.45),
    bottom: new Color(BRAND.butter).lerp(WHITE, 0.25),
  };
}

/**
 * How far each layer is pushed back into the sky, so that Joud's cream edges stay clear in front
 * of the cream façade and the white booths: each colour is blended `sky` of the way towards the
 * sky's blue (its top colour), then scaled to `light` of its brightness (linear RGB, so the hue
 * stays). Not towards the sky at the layer's own height: halfway up, the gradient is a grey cream
 * that is itself close to Joud's edges (model-tests.ts, test 4).
 */
export interface Recede {
  sky: number;
  light: number;
}
export const FAR_RECEDE: Recede = { sky: 0.55, light: 0.95 };
export const NEAR_RECEDE: Recede = { sky: 0.4, light: 1 };

/** Flat coloured triangles in the XY plane, merged into one geometry. */
class Flat {
  private readonly pos: number[] = [];
  private readonly col: number[] = [];
  private z = 0;
  private readonly blue = skyColors().top;

  constructor(
    private readonly fade: number,
    private readonly recede: Recede,
  ) {}

  /** Brand colour faded towards the haze, then pushed back into the sky (see Recede). */
  color(hex: string, extra = 0): Color {
    return new Color(hex)
      .lerp(HAZE, Math.min(1, this.fade + extra))
      .lerp(this.blue, this.recede.sky)
      .multiplyScalar(this.recede.light);
  }

  /** Later shapes are drawn slightly in front of earlier ones. */
  private nextZ(): number {
    this.z += 0.0005;
    return this.z;
  }

  tri(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, c: Color, z: number): void {
    this.pos.push(ax, ay, z, bx, by, z, cx, cy, z);
    for (let i = 0; i < 3; i++) this.col.push(c.r, c.g, c.b);
  }

  rect(x0: number, y0: number, x1: number, y1: number, c: Color): void {
    const z = this.nextZ();
    this.tri(x0, y0, x1, y0, x1, y1, c, z);
    this.tri(x0, y0, x1, y1, x0, y1, c, z);
  }

  /** Trapezoid standing on y0 (palm trunk). */
  trap(x: number, y0: number, y1: number, w0: number, w1: number, c: Color): void {
    const z = this.nextZ();
    this.tri(x - w0 / 2, y0, x + w0 / 2, y0, x + w1 / 2, y1, c, z);
    this.tri(x - w0 / 2, y0, x + w1 / 2, y1, x - w1 / 2, y1, c, z);
  }

  ellipse(x: number, y: number, rx: number, ry: number, rot: number, c: Color, seg = 10): void {
    const z = this.nextZ();
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const p0x = Math.cos(a0) * rx;
      const p0y = Math.sin(a0) * ry;
      const p1x = Math.cos(a1) * rx;
      const p1y = Math.sin(a1) * ry;
      this.tri(x, y, x + p0x * cr - p0y * sr, y + p0x * sr + p0y * cr, x + p1x * cr - p1y * sr, y + p1x * sr + p1y * cr, c, z);
    }
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

// ---------- far layer: the Main Building façade ----------

const FACADE_H = 13;
const PLINTH = 0.45;
const PARAPET = 0.35;
const BAY = 6.4;
const SILLS = [1.1, 5.45, 9.8];
const WIN_W = 1.15;
const WIN_H = 1.5;
const WIN_PAIR_GAP = 0.5;
const WIN_FRAME = 0.08;
const PORTAL_W = 5.7;
const PORTAL_ABOVE = 0.4;
const DOOR_W = 4.4;
/** Bay index (0–5) that holds the entrance portal. */
const PORTAL_BAY = 2;

function facadeTile(b: Flat, x0: number): void {
  const wall = b.color(BRAND.cream);
  const plinth = b.color(BRAND.peach, 0.05);
  const parapet = b.color('#ffffff');
  const frame = b.color('#ffffff');
  const glass = b.color(BRAND.sky, 0.12);
  const shade = b.color(BRAND.peach, 0.15);
  const w = FAR_TILE_M;

  b.rect(x0, 0, x0 + w, PLINTH, plinth);
  b.rect(x0, PLINTH, x0 + w, FACADE_H - PARAPET, wall);
  b.rect(x0, FACADE_H - PARAPET, x0 + w, FACADE_H, parapet);

  for (let bay = 0; bay < 6; bay++) {
    const cx = x0 + (bay + 0.5) * BAY;
    if (bay === PORTAL_BAY) {
      // Portal: a full-height frame, proud of the wall, rising above the roof line.
      const half = PORTAL_W / 2;
      b.rect(cx - half - 0.15, 0, cx + half + 0.15, FACADE_H + PORTAL_ABOVE, shade);
      b.rect(cx - half, 0, cx + half, FACADE_H + PORTAL_ABOVE - 0.2, parapet);
      b.rect(cx - DOOR_W / 2, 0, cx + DOOR_W / 2, 3.4, glass); // entrance doors
      b.rect(cx - half + 0.2, 3.4, cx + half - 0.2, 3.8, shade); // canopy
      b.rect(cx - 1.6, 4.6, cx + 1.6, FACADE_H - 1.2, glass); // tall glazing above
      continue;
    }
    for (const sill of SILLS) {
      for (const side of [-1, 1]) {
        const inner = cx + side * (WIN_PAIR_GAP / 2);
        const outer = inner + side * WIN_W;
        const xa = Math.min(inner, outer);
        const xb = Math.max(inner, outer);
        b.rect(xa - WIN_FRAME, sill - WIN_FRAME, xb + WIN_FRAME, sill + WIN_H + WIN_FRAME, frame);
        b.rect(xa, sill, xb, sill + WIN_H, glass);
      }
    }
  }
}

// ---------- near layer: booth row, palms, string lights ----------

const BOOTH_W = 3;
const BOOTH_POST = 2.5;
const BOOTH_HEADER = 0.36;
const COUNTER_H = 1;
const SIGN_D = 0.7;
const SIGN_INSET = 0.42;
const SIGN_ABOVE = 0.22;
const SIGN_COLORS = [BRAND.redOrange, BRAND.butter, BRAND.sky, BRAND.rose];
const HEADER_COLORS = [BRAND.deepGreen, BRAND.redOrange, BRAND.deepGreen];

function booth(b: Flat, x: number, i: number): void {
  const post = b.color(BRAND.deepGreen);
  b.rect(x, 0, x + BOOTH_W, BOOTH_POST, b.color('#ffffff')); // back panel
  b.rect(x, BOOTH_POST - BOOTH_HEADER, x + BOOTH_W, BOOTH_POST, b.color(HEADER_COLORS[i % HEADER_COLORS.length]));
  b.rect(x + 0.1, 0, x + BOOTH_W - 0.1, COUNTER_H, b.color(BRAND.cream, -0.1)); // counter
  b.rect(x + 0.1, COUNTER_H - 0.06, x + BOOTH_W - 0.1, COUNTER_H, b.color(BRAND.peach));
  b.rect(x - 0.03, 0, x + 0.05, BOOTH_POST, post);
  b.rect(x + BOOTH_W - 0.05, 0, x + BOOTH_W + 0.03, BOOTH_POST, post);
  const r = SIGN_D / 2;
  const sx = x + SIGN_INSET + r;
  const sy = BOOTH_POST + SIGN_ABOVE + r;
  b.rect(sx - 0.02, BOOTH_POST, sx + 0.02, sy, post);
  b.ellipse(sx, sy, r + 0.04, r + 0.04, 0, post, 14);
  b.ellipse(sx, sy, r, r, 0, b.color(SIGN_COLORS[i % SIGN_COLORS.length]), 14);
}

const TRUNK = 4.8;
const CROWN_Y = 5.25;
const FROND = 2.6;
/** Ten fronds (degrees from +x), drooping on both sides. */
const FROND_ANGLES = [-28, 2, 28, 52, 78, 102, 128, 152, 178, 208];

function palm(b: Flat, x: number): void {
  b.trap(x, 0, CROWN_Y - 0.1, 0.52, 0.34, b.color('#7a5a3a'));
  const greens = [b.color(BRAND.leafGreen, -0.12), b.color(BRAND.leafGreen, 0.05)];
  FROND_ANGLES.forEach((deg, i) => {
    const a = (deg * Math.PI) / 180;
    b.ellipse(
      x + Math.cos(a) * FROND * 0.5,
      CROWN_Y + Math.sin(a) * FROND * 0.5,
      FROND * 0.5,
      0.3,
      a,
      greens[i % 2],
      8,
    );
  });
  b.ellipse(x, CROWN_Y, 0.32, 0.3, 0, b.color('#7a5a3a', 0.1), 8);
}

/** Sagging row of small lights between two palm crowns. */
function lights(b: Flat, xa: number, xb: number): void {
  const bulb = b.color(BRAND.butter, -0.3);
  const n = Math.max(2, Math.round((xb - xa) / 1.6));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const y = 4.7 - Math.sin(t * Math.PI) * 0.9;
    b.ellipse(xa + (xb - xa) * t, y, 0.11, 0.11, 0, bulb, 6);
  }
}

function nearTile(b: Flat, x0: number): void {
  // Booths: three in a row after each palm (a palm interval is 12.3–14.2 m).
  let k = 0;
  for (const p of PALMS_M) for (let j = 0; j < 3; j++) booth(b, x0 + p + 1.6 + j * BOOTH_W, k++);
  for (let i = 0; i < PALMS_M.length; i++) {
    const a = PALMS_M[i];
    const next = i + 1 < PALMS_M.length ? PALMS_M[i + 1] : PALMS_M[0] + NEAR_TILE_M;
    lights(b, x0 + a, x0 + next);
  }
  for (const p of PALMS_M) palm(b, x0 + p);
}

/** Two copies of a tile side by side, from −tile to +tile metres. */
function twoTiles(b: Flat, tileM: number, draw: (b: Flat, x0: number) => void): BufferGeometry {
  draw(b, -tileM);
  draw(b, 0);
  return b.build();
}

/** Far layer geometry in metres (y = 0 on the lane floor). */
export function buildFacade(): BufferGeometry {
  return twoTiles(new Flat(0.45, FAR_RECEDE), FAR_TILE_M, facadeTile);
}

/** Near layer geometry in metres (y = 0 on the lane floor). */
export function buildPlazaRow(): BufferGeometry {
  return twoTiles(new Flat(0.22, NEAR_RECEDE), NEAR_TILE_M, nearTile);
}

/**
 * Layer x offset (lane units) for a scroll distance. Layers move with the obstacles (+x) and
 * wrap every tile, so the two copies always cover the visible lane (needs tile ≥ 1 lane width).
 */
export function layerOffset(scroll: number, factor: number, tileUnits: number): number {
  const d = (scroll * factor) % tileUnits;
  return (d < 0 ? d + tileUnits : d) - tileUnits / 2;
}
