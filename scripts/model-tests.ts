// Three view tests of Joud v2 on the game's own background (Amr, 28 Nov 2026), captured from the
// model viewer (play/?debug=1&rig=1&model=v2, game view) on a phone's screen, 390 x 844 CSS px,
// in the game camera's own frame:
//   1. background  the key poses on the viewer's old plain background and on the game's sky and
//                  plaza at the top, middle and bottom of the lane, with how much of the bird's
//                  outline each background swallows
//   2. size        the key poses at birdScale 1.0, 1.15 and 1.3, at the top, middle and bottom
//   3. turn        the glide and the flap with the bird turned -55 (bird.ts), -45 and -40 degrees
//   4. backdrop    the same outline measure, turned -45, at three places along the façade and the
//                  booths; and the obstacles' edges against the backdrop in autoplayed game frames.
//                  With --before=<dist dir>, another build's pictures and numbers beside these.
// Usage: npm run build && node scripts/run-ts.mjs scripts/model-tests.ts   (only some: ... background turn)
// Needs Playwright's Chromium (or MODEL_CHROMIUM, as model:shots) and ffmpeg on the PATH (as model:anim).
//
// Writes docs/screens/model-v2/tests/: test1_background.png and test1_contrast.json, test2_size.png
// and test2_size.json, test3_turn.png and test3_turn.json, test4_backdrop.png, test4_boxes.png
// and test4_backdrop.json (the numbers behind each sheet).
//
// Phone size: the screen is rendered at 2x and scaled down to 1x (lanczos), so a model unit is
// 26 px, as on a phone. The outline measure: the bird is cut out on a flat key colour (&bg=key) in
// the same frame. For each pixel of its outline, the bird's colour just inside is compared (CIELAB,
// ΔE 1976) with the background just outside, rendered without the bird. Under ΔE 10 the edge is lost.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Browser, Page } from '@playwright/test';
import { MOBILE1 } from '../src/core/ruleset';
import { laneFrame } from '../src/mobile/game-backdrop';
import type { ModelApi, Pose } from '../src/mobile/model-view';
import { launch, type ModelWindow, OUT, openViewer, PORT, startServer } from './model-shots';

const DIR = resolve(OUT, 'tests');
const W = 390; // a phone's screen, CSS px
const H = 844;
const DPR = 2;
const GAME = MOBILE1.modes.normal;
const MODEL_UNIT = 0.2 * (GAME.birdRadius / 0.12); // lane units per model unit (model-view.ts)
const FRAME = laneFrame(GAME.laneW, GAME.laneH, W, H);
const LANE_PX = W / (2 * FRAME.halfW); // CSS px per lane unit
const UNIT_PX = LANE_PX * MODEL_UNIT; // 26
const PLAIN_ZOOM = UNIT_PX / (H / 2 / 4.5); // the plain game view shows 4.5 model units above and below its centre
const PLAIN = [0xe9, 0xee, 0xf5]; // model-view.ts BG
const KEY = [0xff, 0x00, 0xff]; // model-view.ts KEY
const LOST = 10; // ΔE: the outline is lost against the background
const WEAK = 20;

const LANE_Y = { top: 0.7, middle: 0, bottom: -0.7 } as const; // lane units; the hitbox reaches ±0.86
type Place = keyof typeof LANE_Y;
const PLACES = Object.keys(LANE_Y) as Place[];
const SCALES = [1, 1.15, 1.3];
const TURNS = [-55, -45, -40];

interface Shot {
  label: string;
  pose: Pose;
  t: number;
}
const KEY_POSES: Shot[] = [
  { label: 'idle', pose: 'idle', t: 0.5 },
  { label: 'flap, raised', pose: 'flap', t: 2 / 24 },
  { label: 'flap, downstroke', pose: 'flap', t: 5 / 24 },
  { label: 'glide', pose: 'glide', t: 0.5 },
  { label: 'fall', pose: 'fall', t: 0.2 },
];
const TURN_SHOTS: Shot[] = [
  { label: 'glide', pose: 'glide', t: 0.5 },
  ...[0, 2, 3, 4, 5, 6, 8].map((f) => ({ label: `flap ${f}`, pose: 'flap' as Pose, t: f / 24 })),
];

type SetOptions = Parameters<ModelApi['set']>[0];
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Cell {
  label: string;
  png: Buffer;
  w: number;
  h: number;
  note?: string;
  /** Extra marks drawn over the picture (CSS px within the cell). */
  svg?: string;
}

let TMP = '';
let count = 0;
let PRESENT_TILT = 14;

/**
 * The hitbox centre (the model's root) on the screen, CSS px. The same at every zoom: the viewer's
 * framed camera closes in on the root (model-view.ts applyView).
 */
function rootOn(w: number, h: number, laneY: number): [number, number] {
  const f = laneFrame(GAME.laneW, GAME.laneH, w, h);
  const px = w / (2 * f.halfW);
  return [w / 2 + GAME.birdX * px, h / 2 - (laneY - f.cy) * px];
}
const rootPx = (laneY: number): [number, number] => rootOn(W, H, laneY);
/**
 * Large views close in on the root, which a phone's screen has 59 px to its right: they are
 * rendered on a wider screen (the game camera's frame for it, the same lane height).
 */
const WIDE = 1000;

/** A w x h box around the bird's root at (rx, ry), kept on the screen. */
function boxAt([rx, ry]: [number, number], w: number, h: number, screenW = W): Box {
  const x = Math.round(Math.max(0, Math.min(screenW - w, rx - w / 2)));
  const y = Math.round(Math.max(0, Math.min(H - h, ry - h * 0.6)));
  return { x, y, w, h };
}

async function capture(page: Page, o: SetOptions, t: number): Promise<string> {
  await page.evaluate((v) => (window as ModelWindow).__joudModel!.set(v), o);
  await page.evaluate((v) => (window as ModelWindow).__joudModel!.seek(v), t);
  const file = join(TMP, `${count++}.png`);
  await page.screenshot({ path: file });
  return file;
}

function ffmpeg(args: string[], input?: Buffer): Buffer {
  const r = spawnSync('ffmpeg', ['-v', 'error', ...args], { input, maxBuffer: 256 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error(`ffmpeg failed: ${r.error?.message ?? r.stderr}`);
  return r.stdout;
}
const cropArg = (b: Box): string => `crop=${b.w * DPR}:${b.h * DPR}:${b.x * DPR}:${b.y * DPR}`;
/** The box at phone size (1x, lanczos), or at the rendered 2x. */
const cropPng = (file: string, b: Box, scale: 1 | 2 = 1): Buffer =>
  ffmpeg(['-i', file, '-vf', scale === 1 ? `${cropArg(b)},scale=${b.w}:${b.h}:flags=lanczos` : cropArg(b), '-f', 'image2pipe', '-vcodec', 'png', '-']);
const cropRaw = (file: string, b: Box): Buffer => ffmpeg(['-i', file, '-vf', cropArg(b), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
/** Raw 2x pixels to PNG; `part`: only that box (CSS px within the raw picture), shown at 4x. */
const rawToPng = (rgb: Buffer, w: number, h: number, part?: Box): Buffer =>
  ffmpeg([
    ...['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${w}x${h}`, '-i', '-'],
    ...(part ? ['-vf', `${cropArg(part)},scale=iw*2:ih*2:flags=neighbor`] : []),
    ...['-f', 'image2pipe', '-vcodec', 'png', '-'],
  ], rgb);

// --- the outline measure ---------------------------------------------------------------------------
function lab(r: number, g: number, b: number): [number, number, number] {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (t * 24389) / 27 / 116 + 16 / 116);
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const deltaE = (a: number[], b: number[]): number => {
  const p = lab(a[0], a[1], a[2]);
  const q = lab(b[0], b[1], b[2]);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

interface Outline {
  /** Outline pixels measured (2x). */
  pixels: number;
  /** Share of them under ΔE 10, and from 10 to 20. */
  lost: number;
  weak: number;
  median: number;
  /** The outline drawn over a washed-out copy: red lost, amber weak, green clear (2x). */
  map: Buffer;
}

/** `key`: the bird on KEY; `back`: the same box without the bird (or one flat colour). */
function measure(key: Buffer, back: Buffer | number[], w: number, h: number): Outline {
  const n = w * h;
  const bird = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(key[i * 3] - KEY[0], key[i * 3 + 1] - KEY[1], key[i * 3 + 2] - KEY[2]);
    bird[i] = d > 90 ? 1 : 0;
  }
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : bird[y * w + x]);
  const inner = new Uint8Array(n); // well inside the bird: no key colour mixed in
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let all = 1;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) all &= at(x + dx, y + dy);
      inner[y * w + x] = all;
    }
  const bg = (i: number, c: number) => (Array.isArray(back) ? back[c] : (back as Buffer)[i * 3 + c]);
  const map = Buffer.alloc(n * 3);
  for (let i = 0; i < n; i++)
    for (let c = 0; c < 3; c++) {
      const v = bird[i] ? key[i * 3 + c] : bg(i, c);
      map[i * 3 + c] = Math.round(255 - (255 - v) * (bird[i] ? 0.45 : 0.3));
    }
  const R = 3;
  const des: number[] = [];
  let lost = 0;
  let weak = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!bird[i] || (at(x - 1, y) && at(x + 1, y) && at(x, y - 1) && at(x, y + 1))) continue;
      const a = [0, 0, 0, 0];
      const b = [0, 0, 0, 0];
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h || dx * dx + dy * dy > R * R) continue;
          const j = yy * w + xx;
          if (inner[j]) for (let c = 0; c < 3; c++) a[c] += key[j * 3 + c], c === 0 && a[3]++;
          if (!bird[j]) for (let c = 0; c < 3; c++) b[c] += bg(j, c), c === 0 && b[3]++;
        }
      if (!a[3] || !b[3]) continue; // a line thinner than the window (glasses, legs): no inside colour
      const e = deltaE([a[0] / a[3], a[1] / a[3], a[2] / a[3]], [b[0] / b[3], b[1] / b[3], b[2] / b[3]]);
      des.push(e);
      if (e < LOST) lost++;
      else if (e < WEAK) weak++;
      const col = e < LOST ? [214, 40, 40] : e < WEAK ? [240, 160, 0] : [30, 150, 80];
      for (let c = 0; c < 3; c++) map[i * 3 + c] = col[c];
    }
  des.sort((p, q) => p - q);
  const m = des.length;
  return { pixels: m, lost: m ? lost / m : 0, weak: m ? weak / m : 0, median: m ? des[m >> 1] : 0, map };
}

/** The bird's extent at phone size (CSS px from its root, the hitbox centre), cut out on &bg=key. */
interface Extent {
  above: number;
  below: number;
  width: number;
  /** Silhouette area, CSS px², and the share of it outside the hitbox circle. */
  area: number;
  outsideHitboxPct: number;
}
async function extent(page: Page, o: SetOptions, t: number): Promise<Extent> {
  const [rx, ry] = rootPx(0);
  const b = boxAt([rx, ry], 160, 170);
  const raw = cropRaw(await capture(page, { ...common(), ...o, bg: 'key', laneY: 0 }, t), b);
  const w = b.w * DPR;
  let top = Infinity;
  let bottom = -Infinity;
  let left = Infinity;
  let right = -Infinity;
  let area = 0;
  let outside = 0;
  for (let i = 0; i < w * b.h * DPR; i++) {
    if (Math.hypot(raw[i * 3] - KEY[0], raw[i * 3 + 1] - KEY[1], raw[i * 3 + 2] - KEY[2]) <= 90) continue;
    const x = b.x + (i % w) / DPR;
    const y = b.y + Math.floor(i / w) / DPR;
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
    left = Math.min(left, x);
    right = Math.max(right, x);
    area++;
    if (Math.hypot(x - rx, y - ry) > GAME.birdRadius * LANE_PX) outside++;
  }
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return { above: r1(ry - top), below: r1(bottom - ry), width: r1(right - left), area: Math.round(area / (DPR * DPR)), outsideHitboxPct: r1((outside / Math.max(1, area)) * 100) };
}

// --- sheets --------------------------------------------------------------------------------------------
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
function grid(title: string, cols: string[], rows: { label: string; cells: Cell[] }[]): string {
  const cell = (c: Cell) =>
    `<td style="padding:3px;vertical-align:top"><div style="position:relative;width:${c.w}px;height:${c.h}px">` +
    `<img src="data:image/png;base64,${c.png.toString('base64')}" width="${c.w}" height="${c.h}" style="display:block">` +
    (c.svg ? `<svg width="${c.w}" height="${c.h}" style="position:absolute;left:0;top:0">${c.svg}</svg>` : '') +
    `</div>${c.note ? `<div style="font-size:11px;line-height:1.3;max-width:${c.w}px">${esc(c.note)}</div>` : ''}</td>`;
  return (
    `<h3 style="margin:14px 0 4px">${esc(title)}</h3><table style="border-collapse:collapse">` +
    `<tr><th></th>${cols.map((c, i) => `<th style="font-weight:600;font-size:12px;text-align:left;padding:3px;vertical-align:bottom;max-width:${rows[0]?.cells[i]?.w ?? 150}px">${esc(c)}</th>`).join('')}</tr>` +
    rows.map((r) => `<tr><th style="font-size:12px;text-align:right;padding:3px 6px;white-space:pre-line;vertical-align:middle">${esc(r.label)}</th>${r.cells.map(cell).join('')}</tr>`).join('') +
    `</table>`
  );
}

async function writeSheet(browser: Browser, file: string, heading: string, intro: string, body: string): Promise<void> {
  const html =
    `<body style="margin:0;padding:10px 14px;background:#fff;font:13px system-ui,sans-serif;color:#222;width:max-content">` +
    `<h2 style="margin:4px 0">${esc(heading)}</h2><div style="max-width:1100px;line-height:1.4">${intro}</div>${body}</body>`;
  const p = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
  await p.setContent(html, { waitUntil: 'load' });
  const size = await p.evaluate(() => [document.body.scrollWidth, document.body.scrollHeight]);
  await p.setViewportSize({ width: size[0] + 28, height: 600 });
  await p.screenshot({ path: file, fullPage: true });
  await p.close();
  console.log(`[tests] ${file}`);
}

const hitbox = (b: Box, laneY: number, scale = 1): string => {
  const [rx, ry] = rootPx(laneY);
  return `<circle cx="${(rx - b.x) * scale}" cy="${(ry - b.y) * scale}" r="${GAME.birdRadius * LANE_PX * scale}" fill="none" stroke="#d0021b" stroke-width="1" stroke-dasharray="3 2"/>`;
};
const common = (): SetOptions => ({ view: 'game', tilt: PRESENT_TILT, zoom: 1, turn: -55, birdScale: 1, laneY: 0 });

// --- test 1: background --------------------------------------------------------------------------------
async function testBackground(browser: Browser, page: Page): Promise<void> {
  const cw = 150;
  const ch = 140;
  /** The outline maps show the middle of each box, MAP_W x MAP_H CSS px around the bird, at 4x. */
  const MAP_W = 84;
  const MAP_H = 76;
  const mapPart = (b: Box): Box => {
    const [rx, ry] = rootPx(0);
    const mid = boxAt(rootPx(0), cw, ch);
    const x = Math.round(rx - mid.x - MAP_W / 2);
    const y = Math.round(ry - mid.y - MAP_H * 0.62);
    return { x: Math.max(0, Math.min(b.w - MAP_W, x)), y: Math.max(0, Math.min(b.h - MAP_H, y)), w: MAP_W, h: MAP_H };
  };
  const cols = ['plain #e9eef5 (the viewer until now)', ...PLACES.map((p) => `game sky, ${p} of the lane (laneY ${LANE_Y[p]})`)];
  const phone: { label: string; cells: Cell[] }[] = [];
  const maps: { label: string; cells: Cell[] }[] = [];
  const numbers: Record<string, Record<string, { lostPct: number; weakPct: number; medianDeltaE: number; pixels: number }>> = {};
  // The background alone at each place: the bird is moved to the other end of the lane.
  const backs = new Map<Place, string>();
  for (const p of PLACES) backs.set(p, await capture(page, { ...common(), bg: 'game', pose: 'glide', laneY: LANE_Y[p] >= 0 ? -0.86 : 0.86 }, 0.5));
  for (const s of KEY_POSES) {
    const row: Cell[] = [];
    const mrow: Cell[] = [];
    numbers[s.label] = {};
    // plain: the old game view (camera on the bird), zoomed to phone size; measured against BG
    const plainFile = await capture(page, { ...common(), bg: 'plain', pose: s.pose, zoom: PLAIN_ZOOM }, s.t);
    const mid = boxAt(rootPx(0), cw, ch);
    const plainRoot: [number, number] = [W / 2, H / 2 + 0.2 * UNIT_PX];
    const plainBox: Box = { x: Math.round(plainRoot[0] - (rootPx(0)[0] - mid.x)), y: Math.round(plainRoot[1] - (rootPx(0)[1] - mid.y)), w: cw, h: ch };
    const keyMid = await capture(page, { ...common(), bg: 'key', pose: s.pose, laneY: 0 }, s.t);
    const o = measure(cropRaw(keyMid, mid), PLAIN, cw * DPR, ch * DPR);
    numbers[s.label].plain = { lostPct: +(o.lost * 100).toFixed(1), weakPct: +(o.weak * 100).toFixed(1), medianDeltaE: +o.median.toFixed(1), pixels: o.pixels };
    row.push({ label: 'plain', png: cropPng(plainFile, plainBox), w: cw, h: ch, note: `lost ${(o.lost * 100).toFixed(0)} %, weak ${(o.weak * 100).toFixed(0)} %, median ΔE ${o.median.toFixed(0)}` });
    mrow.push({ label: 'plain', png: rawToPng(o.map, cw * DPR, ch * DPR, mapPart(mid)), w: MAP_W * 4, h: MAP_H * 4 });
    for (const p of PLACES) {
      const b = boxAt(rootPx(LANE_Y[p]), cw, ch);
      const shown = await capture(page, { ...common(), bg: 'game', pose: s.pose, laneY: LANE_Y[p] }, s.t);
      const key = await capture(page, { ...common(), bg: 'key', pose: s.pose, laneY: LANE_Y[p] }, s.t);
      const m = measure(cropRaw(key, b), cropRaw(backs.get(p)!, b), cw * DPR, ch * DPR);
      numbers[s.label][p] = { lostPct: +(m.lost * 100).toFixed(1), weakPct: +(m.weak * 100).toFixed(1), medianDeltaE: +m.median.toFixed(1), pixels: m.pixels };
      row.push({ label: p, png: cropPng(shown, b), w: cw, h: ch, note: `lost ${(m.lost * 100).toFixed(0)} %, weak ${(m.weak * 100).toFixed(0)} %, median ΔE ${m.median.toFixed(0)}` });
      mrow.push({ label: p, png: rawToPng(m.map, cw * DPR, ch * DPR, mapPart(b)), w: MAP_W * 4, h: MAP_H * 4 });
    }
    phone.push({ label: s.label, cells: row });
    maps.push({ label: s.label, cells: mrow });
  }
  writeFileSync(
    resolve(DIR, 'test1_contrast.json'),
    `${JSON.stringify({ note: `Outline of the bird against what is behind it (CIELAB ΔE 1976, 2x pixels). lost: ΔE < ${LOST}; weak: ${LOST} to ${WEAK}.`, poses: numbers }, null, 2)}\n`,
  );
  await writeSheet(
    browser,
    resolve(DIR, 'test1_background.png'),
    'Test 1: the old plain background and the game’s own sky and plaza',
    `Game view as the game camera frames it on a 390 × 844 phone (turned −55°, leaning ${PRESENT_TILT}°, birdScale 1). ` +
      `Under each picture: how much of Joud’s outline is <b>lost</b> (ΔE under ${LOST}: the bird’s edge and the background are nearly the same colour) ` +
      `or <b>weak</b> (ΔE ${LOST} to ${WEAK}), and the median colour difference along the outline.`,
    grid('Phone size (1x, 26 px per model unit)', cols, phone) +
      grid(`Outline maps (4x, the middle of each picture): red lost, amber weak, green clear`, cols, maps),
  );
}

// --- test 2: size -------------------------------------------------------------------------------------
async function testSize(browser: Browser, page: Page): Promise<void> {
  const cw = 150;
  const ch = 140;
  let body = '';
  // the whole screen first, gliding at the middle of the lane
  const screens: Cell[] = [];
  for (const sc of SCALES) {
    const f = await capture(page, { ...common(), bg: 'game', pose: 'glide', birdScale: sc }, 0.5);
    screens.push({ label: `${sc}`, png: cropPng(f, { x: 0, y: 0, w: W, h: H }), w: W, h: H });
  }
  body += grid('The whole screen (phone size), gliding at the middle of the lane', SCALES.map((s) => `birdScale ${s}`), [{ label: '', cells: screens }]);
  const sizes: Record<string, Record<string, Extent>> = {};
  for (const sc of SCALES) {
    sizes[sc] = {};
    for (const s of KEY_POSES) sizes[sc][s.label] = await extent(page, { pose: s.pose, birdScale: sc }, s.t);
  }
  writeFileSync(
    resolve(DIR, 'test2_size.json'),
    `${JSON.stringify(
      {
        note: `CSS px on a 390 x 844 phone, measured from the hitbox centre. Hitbox radius ${(GAME.birdRadius * LANE_PX).toFixed(1)} px; the narrowest normal gap is ${(GAME.gapMin * LANE_PX).toFixed(1)} px, so ${((GAME.gapMin / 2) * LANE_PX).toFixed(1)} px above and below a bird centred in it.`,
        birdScale: sizes,
      },
      null,
      2,
    )}\n`,
  );
  for (const p of PLACES) {
    const rows: { label: string; cells: Cell[] }[] = [];
    for (const sc of SCALES) {
      const cells: Cell[] = [];
      for (const s of KEY_POSES) {
        const f = await capture(page, { ...common(), bg: 'game', pose: s.pose, laneY: LANE_Y[p], birdScale: sc }, s.t);
        cells.push({ label: s.label, png: cropPng(f, boxAt(rootPx(LANE_Y[p]), cw, ch)), w: cw, h: ch });
      }
      rows.push({ label: `birdScale ${sc}`, cells });
    }
    body += grid(`Phone size: ${p} of the lane (laneY ${LANE_Y[p]})`, KEY_POSES.map((s) => s.label), rows);
  }
  // in the narrowest gap of the normal mode, with the hitbox, which never changes
  const gap = GAME.gapMin;
  const rows: { label: string; cells: Cell[] }[] = [];
  for (const sc of SCALES) {
    const cells: Cell[] = [];
    for (const s of [KEY_POSES[1], KEY_POSES[2], KEY_POSES[3]]) {
      const f = await capture(page, { ...common(), bg: 'game', pose: s.pose, birdScale: sc }, s.t);
      const b = boxAt(rootPx(0), cw, ch);
      const [, ry] = rootPx(0);
      const top = (ry - b.y - (gap / 2) * LANE_PX) * 2;
      const bottom = (ry - b.y + (gap / 2) * LANE_PX) * 2;
      cells.push({
        label: s.label,
        png: cropPng(f, b, 2),
        w: cw * 2,
        h: ch * 2,
        svg:
          `<line x1="0" x2="${cw * 2}" y1="${top}" y2="${top}" stroke="#1d2b22" stroke-width="2"/>` +
          `<line x1="0" x2="${cw * 2}" y1="${bottom}" y2="${bottom}" stroke="#1d2b22" stroke-width="2"/>` +
          hitbox(b, 0, 2),
      });
    }
    rows.push({ label: `birdScale ${sc}`, cells });
  }
  body += grid(
    `2x: the narrowest gap of the normal mode (${gap} lane = ${Math.round(gap * LANE_PX)} px on the phone, black lines) and the hitbox (red, ${Math.round(2 * GAME.birdRadius * LANE_PX)} px), which never changes`,
    ['flap, raised', 'flap, downstroke', 'glide'],
    rows,
  );
  await writeSheet(
    browser,
    resolve(DIR, 'test2_size.png'),
    'Test 2: the drawn bird at birdScale 1.0, 1.15 and 1.3',
    `On the game’s own background, as the game camera frames a 390 × 844 phone (turned −55°, leaning ${PRESENT_TILT}°). ` +
      `birdScale scales the drawn model only (<code>?debug=1&amp;birdScale=</code> in the game); the hitbox stays the ruleset’s birdRadius ${GAME.birdRadius}.`,
    body,
  );
}

// --- test 3: turn -------------------------------------------------------------------------------------
async function testTurn(browser: Browser, page: Page, wide: Page): Promise<void> {
  const f = laneFrame(GAME.laneW, GAME.laneH, WIDE, H);
  const wideUnit = (WIDE / (2 * f.halfW)) * MODEL_UNIT; // px per model unit on the wide screen at zoom 1
  const sections: { title: string; on: Page; screenW: number; zoom: number; cw: number; ch: number }[] = [
    { title: 'Phone size (1x), middle of the lane', on: page, screenW: W, zoom: 1, cw: 150, ch: 140 },
    { title: 'Larger (2.5 times phone size, the same frames), to read the shapes', on: wide, screenW: WIDE, zoom: (2.5 * UNIT_PX) / wideUnit, cw: 240, ch: 215 },
  ];
  let body = '';
  const turns: Record<string, Record<string, Extent>> = {};
  for (const turn of TURNS) {
    turns[turn] = {};
    for (const s of [{ label: 'idle', pose: 'idle' as Pose, t: 0.5 }, ...TURN_SHOTS]) turns[turn][s.label] = await extent(page, { pose: s.pose, turn }, s.t);
  }
  writeFileSync(
    resolve(DIR, 'test3_turn.json'),
    `${JSON.stringify({ note: 'CSS px on a 390 x 844 phone at birdScale 1, measured from the hitbox centre; area in px².', turn: turns }, null, 2)}\n`,
  );
  for (const sec of sections) {
    const rows: { label: string; cells: Cell[] }[] = [];
    for (const turn of TURNS) {
      const cells: Cell[] = [];
      for (const s of TURN_SHOTS) {
        const file = await capture(sec.on, { ...common(), bg: 'game', pose: s.pose, turn, zoom: sec.zoom }, s.t);
        const root = rootOn(sec.screenW, H, 0);
        cells.push({ label: s.label, png: cropPng(file, boxAt(root, sec.cw, sec.ch, sec.screenW)), w: sec.cw, h: sec.ch });
      }
      rows.push({ label: `turned ${turn}°${turn === -55 ? '\n(bird.ts now)' : ''}`, cells });
    }
    body += grid(sec.title, TURN_SHOTS.map((s) => `${s.label} (${s.t.toFixed(2)} s)`), rows);
  }
  await writeSheet(
    browser,
    resolve(DIR, 'test3_turn.png'),
    'Test 3: the bird turned −55°, −45° and −40°',
    `Glide (the arc: 20° at the shoulder, mid and tip 9° down each, 8° forward twist) and the flap stroke, on the game’s own background, leaning ${PRESENT_TILT}° towards the camera, birdScale 1. ` +
      `0° faces the camera, −90° is a profile facing left.`,
    body,
  );
}

// --- test 4: the backdrop pushed back ---------------------------------------------------------------
// Joud's outline as in test 1, now at the turn Amr picked (TEST4_TURN), at three places along the
// façade and the booths (SCROLLS), on this build and on a "before" build (--before=<dist dir>,
// served on BEFORE_PORT). Then the obstacles in the game itself (autoplay, effects off, one seed,
// the clock stopped): how clearly each column's sides and gap ends stand out from what is behind.
const TEST4_TURN = -45;
/** Lane units the obstacles have moved: 0 is the backdrop with effects off, 6 and 12 two more places. */
const SCROLLS = [0, 6, 12];
const BEFORE_PORT = 4184;
/** Game frames: a round's seed and the milliseconds of autoplay before the picture (three obstacles on screen). */
const GAME_FRAMES = [0x5eed1234, 0x5eed1235, 0x5eed1236, 0x5eed1237].map((seed) => ({ seed, ms: 3900 }));
const BOX_H = 0.06; // view.ts
const BOX_SEAM = 0.004;
/** Where each band of the backdrop ends (lane y): booths and signs below, façade and palms up to its parapet. */
const BAND_TOP = { booths: -GAME.laneH / 2 + 3.42 * 0.085, facade: -GAME.laneH / 2 + 13.4 * 0.075 };
type Band = 'sky' | 'facade' | 'booths';
const bandAt = (y: number): Band => (y < BAND_TOP.booths ? 'booths' : y < BAND_TOP.facade ? 'facade' : 'sky');

interface Num {
  lostPct: number;
  weakPct: number;
  medianDeltaE: number;
  pixels: number;
}
const num = (m: { lost: number; weak: number; median: number; pixels: number }): Num => ({
  lostPct: +(m.lost * 100).toFixed(1),
  weakPct: +(m.weak * 100).toFixed(1),
  medianDeltaE: +m.median.toFixed(1),
  pixels: m.pixels,
});
const note = (n: Num): string => `lost ${n.lostPct.toFixed(0)} %, weak ${n.weakPct.toFixed(0)} %, median ΔE ${n.medianDeltaE.toFixed(0)}`;

/** Joud's outline on the backdrop: numbers at every scroll, pictures and maps at scroll 0. */
async function birdOnBackdrop(page: Page): Promise<{ n: Record<string, Record<Place, Record<number, Num>>>; shots: Record<string, Record<Place, Cell>>; maps: Record<string, Record<Place, Cell>> }> {
  const cw = 150;
  const ch = 140;
  const MAP_W = 84;
  const MAP_H = 76;
  const base = { ...common(), turn: TEST4_TURN };
  const n: Record<string, Record<Place, Record<number, Num>>> = {};
  const shots: Record<string, Record<Place, Cell>> = {};
  const maps: Record<string, Record<Place, Cell>> = {};
  for (const sc of SCROLLS) {
    const backs = new Map<Place, string>();
    for (const p of PLACES) backs.set(p, await capture(page, { ...base, bg: 'game', pose: 'glide', laneY: LANE_Y[p] >= 0 ? -0.86 : 0.86, scroll: sc }, 0.5));
    for (const s of KEY_POSES) {
      n[s.label] ??= {} as Record<Place, Record<number, Num>>;
      shots[s.label] ??= {} as Record<Place, Cell>;
      maps[s.label] ??= {} as Record<Place, Cell>;
      for (const p of PLACES) {
        const b = boxAt(rootPx(LANE_Y[p]), cw, ch);
        const key = await capture(page, { ...base, bg: 'key', pose: s.pose, laneY: LANE_Y[p], scroll: sc }, s.t);
        const m = measure(cropRaw(key, b), cropRaw(backs.get(p)!, b), cw * DPR, ch * DPR);
        (n[s.label][p] ??= {})[sc] = num(m);
        if (sc !== SCROLLS[0]) continue;
        const shown = await capture(page, { ...base, bg: 'game', pose: s.pose, laneY: LANE_Y[p], scroll: sc }, s.t);
        shots[s.label][p] = { label: p, png: cropPng(shown, b), w: cw, h: ch, note: note(num(m)) };
        const [rx, ry] = rootPx(LANE_Y[p]);
        const part: Box = { x: Math.max(0, Math.min(cw - MAP_W, Math.round(rx - b.x - MAP_W / 2))), y: Math.max(0, Math.min(ch - MAP_H, Math.round(ry - b.y - MAP_H * 0.62))), w: MAP_W, h: MAP_H };
        maps[s.label][p] = { label: p, png: rawToPng(m.map, cw * DPR, ch * DPR, part), w: MAP_W * 4, h: MAP_H * 4 };
      }
    }
  }
  await page.evaluate(() => (window as ModelWindow).__joudModel!.set({ scroll: 0 }));
  return { n, shots, maps };
}

interface Obstacle {
  x: number;
  gapY: number;
  gap: number;
  gap2: number;
  gap2Y: number;
  updraft: number;
  flower: number;
  flowerY: number;
}
interface GameState {
  birdY: number;
  state: string;
  obstacles: Obstacle[];
  flowerRadius: number;
}

/** The game on a phone after `ms` of autoplay with effects off, paused (so nothing is interpolated). */
async function gameFrame(browser: Browser, port: number, seed: number, ms: number): Promise<{ file: string; st: GameState }> {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, ignoreHTTPSErrors: true });
  await page.addInitScript((s) => {
    // One seed for every round (scene/seed.ts takes it from here): the same obstacles in both builds.
    crypto.getRandomValues = <T extends ArrayBufferView | null>(a: T): T => {
      if (a instanceof Uint32Array) a.fill(s);
      return a;
    };
  }, seed);
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(1000); // time moves only with runFor: the same frames on every run
  await page.goto(`https://localhost:${port}/play/?debug=1&autoplay=1&fx=0&mute=1&tier=high`, { waitUntil: 'load' });
  await page.addStyleTag({ content: '*{visibility:hidden!important;animation:none!important;transition:none!important}canvas{visibility:visible!important}' });
  await page.clock.runFor(ms);
  await page.evaluate(() => (window as unknown as { __joudGame: { suspend(): void } }).__joudGame.suspend());
  await page.clock.runFor(100);
  const st = await page.evaluate(() => {
    const g = (window as unknown as { __joudGame: { bird: { y: number }; state: string; field: { pool: (Obstacle & { active: boolean })[] }; ruleset: { kinds: { flowerRadius: number } } } }).__joudGame;
    return {
      birdY: g.bird.y,
      state: g.state,
      flowerRadius: g.ruleset.kinds.flowerRadius,
      obstacles: g.field.pool.filter((o) => o.active).map((o) => ({ x: o.x, gapY: o.gapY, gap: o.gap, gap2: o.gap2, gap2Y: o.gap2Y, updraft: o.updraft, flower: o.flower, flowerY: o.flowerY })),
    };
  });
  const file = join(TMP, `${count++}.png`);
  await page.screenshot({ path: file });
  await page.close();
  return { file, st };
}

interface EdgeResult {
  bands: Record<Band, { lost: number; weak: number; des: number[] }>;
  map: Buffer;
}

/**
 * Each column of boxes: its left and right sides and the end at the gap. At every sample (2x px)
 * the box's colour 2 to 5 px inside the edge is compared (ΔE 1976) with the backdrop 2 to 5 px
 * outside it, each averaged over a few pixels along the edge. Seams between boxes, the bird, the
 * flowers, the updraft lines and the screen's edges are left out.
 */
function boxEdges(rgb: Buffer, st: GameState): EdgeResult {
  const w = W * DPR;
  const h = H * DPR;
  const px = LANE_PX * DPR;
  const sx = (x: number) => (W / 2 + x * LANE_PX) * DPR;
  const sy = (y: number) => (H / 2 - (y - FRAME.cy) * LANE_PX) * DPR;
  const top = GAME.laneH / 2;
  const half = GAME.pipeWidth / 2;
  const bands: EdgeResult['bands'] = { sky: { lost: 0, weak: 0, des: [] }, facade: { lost: 0, weak: 0, des: [] }, booths: { lost: 0, weak: 0, des: [] } };
  const map = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h * 3; i++) map[i] = Math.round(255 - (255 - rgb[i]) * 0.35);
  const columns: { x: number; y0: number; y1: number; gapEnd: number; obstacle: Obstacle }[] = [];
  for (const o of st.obstacles) {
    let upperY = o.gapY;
    let upper = o.gap;
    let lowerY = o.gapY;
    let lower = o.gap;
    if (o.gap2 > 0) {
      if (o.gap2Y > o.gapY) {
        upperY = o.gap2Y;
        upper = o.gap2;
      } else {
        lowerY = o.gap2Y;
        lower = o.gap2;
      }
      columns.push({ x: o.x, y0: lowerY + lower / 2, y1: upperY - upper / 2, gapEnd: NaN, obstacle: o });
    }
    columns.push({ x: o.x, y0: upperY + upper / 2, y1: top, gapEnd: upperY + upper / 2, obstacle: o });
    columns.push({ x: o.x, y0: -top, y1: lowerY - lower / 2, gapEnd: lowerY - lower / 2, obstacle: o });
  }
  const birdR = 0.075 * px; // the drawn bird and its wings, with a margin
  const avoid = (X: number, Y: number): boolean => {
    if (Math.hypot(X - sx(GAME.birdX), Y - sy(st.birdY)) < birdR) return true;
    for (const o of st.obstacles) if (o.flower === 1 && Math.hypot(X - sx(o.x), Y - sy(o.flowerY)) < st.flowerRadius * 1.6 * px) return true;
    for (const c of columns) if (X >= sx(c.x - half) - 0.5 && X <= sx(c.x + half) - 0.5 && Y >= sy(c.y1) - 0.5 && Y <= sy(c.y0) - 0.5) return true;
    return X < 0 || X >= w || Y < 0 || Y >= h || X < sx(-GAME.laneW / 2) + 2 || X > sx(GAME.laneW / 2) - 2;
  };
  const mean = (X0: number, Y0: number, dx: number, dy: number, ax: number, ay: number): number[] | null => {
    // pixels 2..5 px from the edge along (dx, dy), and -1..1 along the edge (ax, ay)
    const a = [0, 0, 0];
    let k = 0;
    for (let d = 2; d <= 5; d++)
      for (let t = -1; t <= 1; t++) {
        const X = Math.round(X0 + dx * d + ax * t);
        const Y = Math.round(Y0 + dy * d + ay * t);
        if (X < 0 || Y < 0 || X >= w || Y >= h) return null;
        const j = (Y * w + X) * 3;
        for (let c = 0; c < 3; c++) a[c] += rgb[j + c];
        k++;
      }
    return a.map((v) => v / k);
  };
  const sample = (X: number, Y: number, dx: number, dy: number, laneY: number): void => {
    // (dx, dy) points out of the box
    for (let d = 2; d <= 5; d++) if (avoid(X + dx * d, Y + dy * d)) return;
    const inside = mean(X, Y, -dx, -dy, dy, dx);
    const outside = mean(X, Y, dx, dy, dy, dx);
    if (!inside || !outside) return;
    const e = deltaE(inside, outside);
    const b = bands[bandAt(laneY)];
    b.des.push(e);
    if (e < LOST) b.lost++;
    else if (e < WEAK) b.weak++;
    const col = e < LOST ? [214, 40, 40] : e < WEAK ? [240, 160, 0] : [30, 150, 80];
    for (let r = -1; r <= 1; r++)
      for (let q = -1; q <= 1; q++) {
        const XX = Math.round(X + dx * 3.5 + q);
        const YY = Math.round(Y + dy * 3.5 + r);
        if (XX >= 0 && YY >= 0 && XX < w && YY < h) for (let c = 0; c < 3; c++) map[(YY * w + XX) * 3 + c] = col[c];
      }
  };
  for (const c of columns) {
    const seams: number[] = []; // lane y of the seams, from the gap edge outwards
    const from = Number.isNaN(c.gapEnd) ? c.y0 : c.gapEnd;
    const dir = from === c.y0 ? 1 : -1;
    for (let d = BOX_H; d < c.y1 - c.y0; d += BOX_H) seams.push(from + dir * (d - BOX_SEAM / 2));
    const nearSeam = (y: number): boolean => seams.some((s) => Math.abs(sy(s) - sy(y)) < 4 + BOX_SEAM * px);
    const xl = sx(c.x - half);
    const xr = sx(c.x + half);
    const lead = c.obstacle.updraft > 0; // the updraft's lines run beside the leading (+x) side
    for (let Y = Math.ceil(sy(c.y1)) + 4; Y <= Math.floor(sy(c.y0)) - 4; Y += 3) {
      const y = FRAME.cy - (Y / DPR - H / 2) / LANE_PX;
      if (nearSeam(y)) continue;
      sample(Math.ceil(xl), Y, -1, 0, y);
      if (!lead) sample(Math.ceil(xr) - 1, Y, 1, 0, y);
    }
    if (!Number.isNaN(c.gapEnd)) {
      const Yend = sy(c.gapEnd);
      const out = c.gapEnd === c.y0 ? 1 : -1; // the gap is below an upper column (screen y grows down)
      for (let X = Math.ceil(xl) + 5; X <= Math.floor(xr) - 5; X += 3) sample(X, out > 0 ? Math.floor(Yend) - 1 : Math.ceil(Yend), 0, out, c.gapEnd);
    }
  }
  return { bands, map };
}

/** As Num, plus the ΔE that the weakest 5 % of the samples fall under. */
const summary = (b: { lost: number; weak: number; des: number[] }): Num & { p5DeltaE: number } => {
  const d = [...b.des].sort((p, q) => p - q);
  return {
    lostPct: +((b.lost / Math.max(1, d.length)) * 100).toFixed(1),
    weakPct: +((b.weak / Math.max(1, d.length)) * 100).toFixed(1),
    medianDeltaE: d.length ? +d[d.length >> 1].toFixed(1) : 0,
    p5DeltaE: d.length ? +d[Math.floor(d.length * 0.05)].toFixed(1) : 0,
    pixels: d.length,
  };
};

async function testBackdrop(browser: Browser, after: Page, before: Page | null, beforePort: number | null): Promise<void> {
  const builds = before ? (['before', 'after'] as const) : (['after'] as const);
  const pages = { before, after };
  const bird: Partial<Record<'before' | 'after', Awaited<ReturnType<typeof birdOnBackdrop>>>> = {};
  for (const b of builds) bird[b] = await birdOnBackdrop(pages[b]!);
  // the boxes in the game
  const boxes: Partial<Record<'before' | 'after', Record<Band, ReturnType<typeof summary>>>> = {};
  const frames: Partial<Record<'before' | 'after', { file: string; map: Buffer }[]>> = {};
  for (const b of builds) {
    const total: EdgeResult['bands'] = { sky: { lost: 0, weak: 0, des: [] }, facade: { lost: 0, weak: 0, des: [] }, booths: { lost: 0, weak: 0, des: [] } };
    frames[b] = [];
    for (const f of GAME_FRAMES) {
      const { file, st } = await gameFrame(browser, b === 'before' ? beforePort! : PORT, f.seed, f.ms);
      const r = boxEdges(cropRaw(file, { x: 0, y: 0, w: W, h: H }), st);
      for (const k of Object.keys(total) as Band[]) {
        total[k].lost += r.bands[k].lost;
        total[k].weak += r.bands[k].weak;
        total[k].des.push(...r.bands[k].des);
      }
      frames[b]!.push({ file, map: r.map });
    }
    boxes[b] = { sky: summary(total.sky), facade: summary(total.facade), booths: summary(total.booths) };
  }
  const worst = (b: 'before' | 'after', p: Place, pose?: string): Num => {
    const all = Object.entries(bird[b]!.n).filter(([k]) => !pose || k === pose).flatMap(([, v]) => Object.values(v[p]));
    return all.reduce((a, c) => (c.lostPct > a.lostPct ? c : a));
  };
  writeFileSync(
    resolve(DIR, 'test4_backdrop.json'),
    `${JSON.stringify(
      {
        note:
          `Joud's outline against the backdrop as in test 1 (CIELAB ΔE 1976, 2x pixels; lost: ΔE < ${LOST}; weak: ${LOST} to ${WEAK}), turned ${TEST4_TURN}°, ` +
          `at backdrop scroll ${SCROLLS.join(', ')} (lane units). Boxes: the sides and gap ends of every column in ${GAME_FRAMES.length} game frames ` +
          `(autoplay, effects off, seeds ${GAME_FRAMES.map((f) => f.seed).join(', ')}, ${GAME_FRAMES[0].ms} ms), by what is behind them: booths (lane y < ${BAND_TOP.booths.toFixed(3)}), façade and palms (< ${BAND_TOP.facade.toFixed(3)}), sky.`,
        bird: Object.fromEntries(builds.map((b) => [b, bird[b]!.n])),
        worstPerPlace: Object.fromEntries(builds.map((b) => [b, Object.fromEntries(PLACES.map((p) => [p, worst(b, p)]))])),
        boxes,
      },
      null,
      2,
    )}\n`,
  );
  // sheet 1: the bird, phone size first
  const cols = PLACES.flatMap((p) => builds.map((b) => `${p}, ${b}`));
  const phone = KEY_POSES.map((s) => ({ label: s.label, cells: PLACES.flatMap((p) => builds.map((b) => bird[b]!.shots[s.label][p])) }));
  const mapRows = KEY_POSES.map((s) => ({ label: s.label, cells: PLACES.flatMap((p) => builds.map((b) => bird[b]!.maps[s.label][p])) }));
  const worstLine = builds
    .map((b) => `<b>${b}</b>: worst lost over all poses and the ${SCROLLS.length} scrolls: ${PLACES.map((p) => `${p} ${worst(b, p).lostPct.toFixed(1)} %`).join(', ')}`)
    .join('<br>');
  await writeSheet(
    browser,
    resolve(DIR, 'test4_backdrop.png'),
    'Test 4: Joud on the backdrop, before and after pushing it back',
    `As test 1, on a 390 × 844 phone in the game camera’s frame, turned ${TEST4_TURN}°, leaning ${PRESENT_TILT}°, birdScale 1. ` +
      `Pictures at scroll 0 (the backdrop with effects off); the numbers cover scrolls ${SCROLLS.join(', ')} as well.<br>${worstLine}`,
    grid('Phone size (1x, 26 px per model unit), scroll 0', cols, phone) + grid('Outline maps (4x): red lost, amber weak, green clear', cols, mapRows),
  );
  // sheet 2: the boxes in the game
  const boxNote = (b: 'before' | 'after') =>
    `${b}: ${(['sky', 'facade', 'booths'] as Band[]).map((k) => `${k === 'facade' ? 'façade' : k} lost ${boxes[b]![k].lostPct.toFixed(1)} %, weak ${boxes[b]![k].weakPct.toFixed(1)} %, median ΔE ${boxes[b]![k].medianDeltaE.toFixed(0)}, weakest 5 % under ${boxes[b]![k].p5DeltaE.toFixed(0)}`).join('; ')}`;
  const screenRows = builds.map((b) => ({
    label: b,
    cells: frames[b]!.map((f, i) => ({ label: `seed ${i + 1}`, png: cropPng(f.file, { x: 0, y: 0, w: W, h: H }), w: W, h: H })),
  }));
  const edgeRows = builds.map((b) => ({
    label: b,
    cells: frames[b]!.map((f, i) => ({
      label: `seed ${i + 1}`,
      png: ffmpeg(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W * DPR}x${H * DPR}`, '-i', '-', '-vf', `scale=${W}:${H}:flags=area`, '-f', 'image2pipe', '-vcodec', 'png', '-'], f.map),
      w: W,
      h: H,
    })),
  }));
  await writeSheet(
    browser,
    resolve(DIR, 'test4_boxes.png'),
    'Test 4: the boxes against the backdrop, before and after',
    `The game itself on a 390 × 844 phone (autoplay, effects off, four seeds, the clock stopped after ${GAME_FRAMES[0].ms} ms; the page’s text hidden). ` +
      `Each column’s sides and gap ends: the box just inside the edge against the backdrop just outside it (ΔE 1976).<br>${builds.map(boxNote).join('<br>')}`,
    grid('Phone size (1x)', GAME_FRAMES.map((_f, i) => `seed ${i + 1}`), screenRows) + grid('Edge samples: red lost (ΔE < 10), amber weak (10 to 20), green clear', GAME_FRAMES.map((_f, i) => `seed ${i + 1}`), edgeRows),
  );
}

export async function main(args: string[] = []): Promise<number> {
  if (spawnSync('ffmpeg', ['-version']).status !== 0) {
    console.error('[tests] ffmpeg is not on the PATH: it crops and scales the screenshots. Install it and run again.');
    return 1;
  }
  const only = args.filter((a) => !a.startsWith('-'));
  const want = (name: string): boolean => only.length === 0 || only.includes(name);
  const server = startServer();
  let beforeServer: ReturnType<typeof startServer> | null = null;
  const browser = await launch();
  TMP = mkdtempSync(join(tmpdir(), 'joud-tests-'));
  try {
    const page = await openViewer(browser, W, H, undefined, DPR);
    const info = await page.evaluate(() => (window as ModelWindow).__joudModel!.info());
    PRESENT_TILT = info.presentTilt;
    await page.evaluate(() => (window as ModelWindow).__joudModel!.set({ manual: true, ui: false, ref: false, status: false }));
    mkdirSync(DIR, { recursive: true });
    if (want('background')) await testBackground(browser, page);
    if (want('size')) await testSize(browser, page);
    if (want('backdrop')) {
      // --before=<dist dir>: the same pictures from another build, side by side
      const beforeDir = args.find((a) => a.startsWith('--before='))?.slice('--before='.length);
      let before: Page | null = null;
      if (beforeDir) {
        beforeServer = startServer(BEFORE_PORT, resolve(beforeDir));
        before = await openViewer(browser, W, H, undefined, DPR, BEFORE_PORT);
        await before.evaluate(() => (window as ModelWindow).__joudModel!.set({ manual: true, ui: false, ref: false, status: false }));
      }
      await testBackdrop(browser, page, before, beforeDir ? BEFORE_PORT : null);
    }
    if (want('turn')) {
      const wide = await openViewer(browser, WIDE, H, undefined, DPR);
      await wide.evaluate(() => (window as ModelWindow).__joudModel!.set({ manual: true, ui: false, ref: false, status: false }));
      await testTurn(browser, page, wide);
    }
    return 0;
  } finally {
    await browser.close();
    server.kill();
    beforeServer?.kill();
    rmSync(TMP, { recursive: true, force: true });
  }
}
