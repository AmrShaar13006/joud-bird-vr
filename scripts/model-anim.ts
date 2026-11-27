// Contact sheets and GIFs of Joud v2's animation clips, captured from the model viewer
// (play/?debug=1&rig=1&model=v2) in headless Chromium: the same code that will draw them on a phone.
// Usage: npm run build && npm run model:anim      (only some: npm run model:anim -- flap tap)
// Needs Playwright's Chromium (or MODEL_CHROMIUM, as model:shots) and ffmpeg on the PATH.
// ffmpeg is a machine tool here, like Blender: nothing is added to package.json.
//
// Writes docs/screens/model-v2/anim/:
//   sheet_<clip>.jpg          8 frames of each clip: the game view above, the front below
//   <name>_game.gif, <name>_front.gif   tap, flap, glide, fall, crash, idle at their real speed
//   flap_game_half-speed.gif  the flap stroke slowed down, to read the anticipation and the lag
//   tap_game_phone-size.gif   the tap demo at the size a phone shows the bird
//   tap-timeline.json         what the tap demo played, frame by frame (clip, speed, height, tilt)
// The viewer's clock is driven by hand (api.step), so the frames do not depend on how fast the
// machine renders.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Browser, Page } from '@playwright/test';
import type { AnimState, Clip, ModelApi, ModelInfo, View } from '../src/mobile/model-view';
import { launch, type ModelWindow, OUT, openViewer, startServer } from './model-shots';

const DIR = resolve(OUT, 'anim');
const FPS = 25; // a GIF frame lasts a whole number of 1/100 s: 4
const GIF = 420; // px, square
const CELL = 300; // px, one frame of a contact sheet
const CLIP_FPS = 24; // the clips are authored at 24 fps (tools/blender/joud_clips.py)
const MAX_FILE = 5 * 1024 * 1024; // CLAUDE.md: no file over 5 MB

type Views = Extract<View, 'game' | 'front'>;
const VIEWS: Views[] = ['game', 'front'];
/** Close enough to fill the frame: the game view shows 9 model units at zoom 1, the front about 4.4. */
const ZOOM: Record<Views, Record<Clip | 'tap', number>> = {
  game: { idle: 3.2, flap: 2.4, glide: 2.4, fall: 2.3, crash: 2.4, tap: 1.35 },
  front: { idle: 1.1, flap: 1.2, glide: 1.2, fall: 1.2, crash: 1.2, tap: 1.2 },
};
// A phone shows one model unit as about 26 px: the lane, 1.0 wide, fills a 390 px screen and the
// bird is drawn at 0.2 x birdRadius / 0.12.
const PHONE_SIZE = Math.round((26 * 9) / ZOOM.game.tap);

/** Eight frames of each clip (at 24 fps): the poses that tell its story. */
const SHEET_FRAMES: Record<Clip, number[]> = {
  idle: [0, 12, 26, 60, 72, 90, 100, 120], // breath in, blink, blink as the head turns, turned, back, blink
  flap: [0, 2, 3, 4, 5, 6, 8, 10], // raised, top of the anticipation, the downstroke, the folded recovery, glide
  glide: [0, 4, 7, 11, 15, 18, 22, 25],
  fall: [0, 1, 2, 3, 4, 5, 6, 7],
  crash: [0, 1, 2, 4, 6, 8, 11, 14],
};

/** The tap demo's script: seconds of each tap, then the bird is left to glide, fall and crash. */
const TAPS = [0.6, 1.2, 1.8, 2.4, 2.6, 2.8, 3.0, 3.12, 3.24];
const TAP_SECONDS = 6.4;

type SetOptions = Parameters<ModelApi['set']>[0];
const set = (page: Page, o: SetOptions): Promise<void> => page.evaluate((v) => (window as ModelWindow).__joudModel!.set(v), o);
const step = (page: Page, dt: number): Promise<void> => page.evaluate((v) => (window as ModelWindow).__joudModel!.step(v), dt);
const seek = (page: Page, t: number): Promise<void> => page.evaluate((v) => (window as ModelWindow).__joudModel!.seek(v), t);
const tap = (page: Page): Promise<void> => page.evaluate(() => (window as ModelWindow).__joudModel!.tap());
const anim = (page: Page): Promise<AnimState> => page.evaluate(() => (window as ModelWindow).__joudModel!.anim());

async function stage(page: Page, size: number, view: Views, pose: Clip | 'tap', status = true): Promise<void> {
  await page.setViewportSize({ width: size, height: size });
  await set(page, { view, pose, zoom: ZOOM[view][pose], look: 'lambert', ref: false, ui: false, status, manual: true });
}

function ffmpeg(args: string[]): void {
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.error || r.status !== 0) throw new Error(`ffmpeg failed: ${r.error?.message ?? r.stderr}`);
}

/** frames/0000.png ... -> one looping GIF with a palette of its own. */
function encodeGif(frames: string, file: string, scale?: number): void {
  const pre = scale ? `scale=${scale}:-1:flags=lanczos,` : '';
  ffmpeg([
    '-framerate', String(FPS), '-i', join(frames, '%04d.png'),
    '-filter_complex', `[0:v]${pre}split[a][b];[a]palettegen=max_colors=128:stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=5`,
    '-loop', '0', file,
  ]);
  const size = statSync(file).size;
  if (size > MAX_FILE) throw new Error(`${file} is ${(size / 1e6).toFixed(1)} MB: over the 5 MB limit`);
}

/** Record `count` frames, `dt` seconds apart. `before(i)` runs ahead of the step into frame i, `after(i)` once it is drawn. */
async function record(
  page: Page,
  count: number,
  dt: number,
  before?: (i: number) => Promise<void>,
  after?: (i: number) => Promise<void>,
): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'joud-anim-'));
  for (let i = 0; i < count; i++) {
    if (i > 0) {
      if (before) await before(i);
      await step(page, dt);
    }
    await page.screenshot({ path: join(dir, `${String(i).padStart(4, '0')}.png`), type: 'png' });
    if (after) await after(i);
  }
  return dir;
}

async function clipGifs(page: Page, clip: Clip, info: ModelInfo['clips'][number], log: string[]): Promise<void> {
  // a loop is recorded once round; a one-shot with the hold the viewer gives it before it replays
  const hold = clip === 'flap' ? 0.7 : clip === 'crash' ? 1.3 : 0;
  const count = Math.round((info.duration + hold) * FPS);
  const dt = info.loop ? info.duration / count : 1 / FPS;
  for (const view of VIEWS) {
    await stage(page, GIF, view, clip);
    const dir = await record(page, count, dt);
    const file = resolve(DIR, `${clip}_${view}.gif`);
    encodeGif(dir, file);
    rmSync(dir, { recursive: true });
    log.push(`${clip}_${view}.gif ${count} frames, ${(statSync(file).size / 1024).toFixed(0)} KB`);
  }
  if (clip === 'flap') {
    await stage(page, GIF, 'game', clip);
    const dir = await record(page, count * 2, dt / 2);
    const file = resolve(DIR, 'flap_game_half-speed.gif');
    encodeGif(dir, file);
    rmSync(dir, { recursive: true });
    log.push(`flap_game_half-speed.gif ${count * 2} frames, ${(statSync(file).size / 1024).toFixed(0)} KB`);
  }
}

async function tapGifs(page: Page, log: string[]): Promise<void> {
  const count = Math.round(TAP_SECONDS * FPS);
  for (const view of VIEWS) {
    await stage(page, GIF, view, 'tap');
    const timeline: (AnimState & { t: number })[] = [];
    const dir = await record(
      page,
      count,
      1 / FPS,
      async (i) => {
        // the viewer's clock stands at (i - 1) / FPS here: a tap due now lands before the step into frame i
        if (TAPS.some((at) => Math.abs(at - (i - 1) / FPS) < 0.5 / FPS)) await tap(page);
      },
      async (i) => {
        timeline.push({ t: Number((i / FPS).toFixed(2)), ...(await anim(page)) });
      },
    );
    const file = resolve(DIR, `tap_${view}.gif`);
    encodeGif(dir, file);
    log.push(`tap_${view}.gif ${count} frames, ${(statSync(file).size / 1024).toFixed(0)} KB`);
    if (view === 'game') {
      const small = resolve(DIR, 'tap_game_phone-size.gif');
      encodeGif(dir, small, PHONE_SIZE);
      log.push(`tap_game_phone-size.gif ${PHONE_SIZE} px, ${(statSync(small).size / 1024).toFixed(0)} KB`);
      const rows = timeline.map((s) => ({
        t: s.t, clip: s.clip, clipTime: Number(s.time.toFixed(3)), phase: s.phase, taps: s.taps,
        flapSpeed: Number(s.flapSpeed.toFixed(2)), height: Number(s.y.toFixed(2)), vy: Number(s.vy.toFixed(3)),
        tilt: Number(s.tilt.toFixed(1)),
      }));
      const note = 'The tap demo of the viewer (game view), one row per 1/25 s. Taps at ' + `${TAPS.join(', ')} s. ` +
        'height: model units above the lane centre; vy: lane units per second; tilt: degrees, nose up positive.';
      writeFileSync(resolve(DIR, 'tap-timeline.json'), `${JSON.stringify({ note, taps: TAPS, frames: rows })}\n`);
      // the sequence in words: every change of clip or flap speed
      let last = '';
      for (const r of rows) {
        const key = `${r.clip} x${r.flapSpeed} taps ${r.taps}`;
        if (key !== last) log.push(`  tap demo ${r.t.toFixed(2)} s: ${r.clip}${r.clip === 'flap' ? ` at ${r.flapSpeed}x (tap ${r.taps})` : ''}, height ${r.height}, vy ${r.vy}`);
        last = key;
      }
    }
    rmSync(dir, { recursive: true });
  }
}

/** One labelled sheet per clip: 8 frames from the game view, the same 8 from the front. */
async function sheet(browser: Browser, page: Page, clip: Clip, info: ModelInfo['clips'][number]): Promise<void> {
  const rows: { view: Views; cells: { label: string; data: string }[] }[] = [];
  for (const view of VIEWS) {
    await stage(page, CELL, view, clip, false);
    const cells = [];
    for (const f of SHEET_FRAMES[clip]) {
      await seek(page, Math.min(f / CLIP_FPS, info.duration));
      const shot = await page.screenshot({ type: 'jpeg', quality: 90 });
      cells.push({ label: `frame ${f} · ${(f / CLIP_FPS).toFixed(2)} s`, data: shot.toString('base64') });
    }
    rows.push({ view, cells });
  }
  const html =
    `<body style="margin:0;padding:10px;background:#fff;font:13px system-ui,sans-serif;color:#222">` +
    `<h3 style="margin:2px 0 8px">Joud v2, clip “${clip}”: ${info.duration.toFixed(3)} s at ${CLIP_FPS} fps, ${info.loop ? 'looped' : 'played once'}</h3>` +
    rows
      .map(
        (r) =>
          `<div style="margin:6px 0 2px;font-weight:600">${r.view === 'game' ? 'Game view (the bird turned -55 degrees, no perspective' + (clip === 'fall' ? ', root tilted 30 degrees nose down as the game does while it drops' : '') + ')' : 'Front'}</div>` +
          `<div style="display:grid;grid-template-columns:repeat(8,${CELL}px);gap:4px">` +
          r.cells.map((c) => `<figure style="margin:0;text-align:center"><img src="data:image/jpeg;base64,${c.data}" width="${CELL}" height="${CELL}" style="display:block"><figcaption>${c.label}</figcaption></figure>`).join('') +
          `</div>`,
      )
      .join('') +
    `</body>`;
  const p = await browser.newPage({ viewport: { width: CELL * 8 + 4 * 7 + 20, height: 400 } });
  await p.setContent(html, { waitUntil: 'load' });
  await p.screenshot({ path: resolve(DIR, `sheet_${clip}.jpg`), type: 'jpeg', quality: 86, fullPage: true });
  await p.close();
}

export async function main(args: string[] = []): Promise<number> {
  if (spawnSync('ffmpeg', ['-version']).status !== 0) {
    console.error('[anim] ffmpeg is not on the PATH: it encodes the GIFs. Install it and run again.');
    return 1;
  }
  const only = args.filter((a) => !a.startsWith('-')); // e.g. `npm run model:anim -- flap tap`
  const want = (name: string): boolean => only.length === 0 || only.includes(name);
  const server = startServer();
  const browser = await launch();
  try {
    const page = await openViewer(browser, GIF, GIF);
    mkdirSync(DIR, { recursive: true });
    const info = await page.evaluate(() => (window as ModelWindow).__joudModel!.info());
    if (info.clips.length !== 5) throw new Error(`expected 5 clips in the model, found ${info.clips.map((c) => c.name).join(', ') || 'none'}`);
    const log: string[] = [];
    for (const c of info.clips) {
      const clip = c.name as Clip;
      if (!want(clip)) continue;
      await sheet(browser, page, clip, c);
      await clipGifs(page, clip, c, log);
      console.log(`[anim] ${clip}: ${c.duration.toFixed(3)} s, sheet and GIFs written`);
    }
    if (want('tap')) await tapGifs(page, log);
    for (const line of log) console.log(`[anim] ${line}`);
    console.log(`[anim] written to ${DIR}`);
    return 0;
  } finally {
    await browser.close();
    server.kill();
  }
}
