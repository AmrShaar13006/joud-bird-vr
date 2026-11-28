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
//   <name>_game_phone-size.gif   every clip and the tap demo at the size a phone shows the bird
//   tap-timeline.json         what the tap demo played, frame by frame (clip, speed, height, tilt)
//   glide_game_tilt-off-and-on*.gif   the glide without and with the presentation tilt, side by side
// With an earlier model to compare with (npm run model:anim -- compare --before=<old joud-v2.glb>,
// for example from `git show 807175b:public/models/joud-v2.glb > before.glb`), also:
//   before-after_tap*.gif, before-after_glide*.gif   the old model without the tilt beside this one
//   before-after_poses.jpg    the key poses of both, large and at phone size
// Each pair comes large and at phone size (_phone-size).
// The viewer's clock is driven by hand (api.step), so the frames do not depend on how fast the
// machine renders.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
let PRESENT_TILT = 14; // the game view's lean towards the camera: read from the viewer (model-view.ts) in main()
let GAME_TURN = -45; // the game view's turn about Y: read from the viewer in main() as well

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

/** `phone`: framed as the tap demo is, so that scaled to PHONE_SIZE the bird is as large as on a phone. */
async function stage(page: Page, size: number, view: Views, pose: Clip | 'tap', status = true, phone = false, tilt: number = PRESENT_TILT): Promise<void> {
  await page.setViewportSize({ width: size, height: size });
  const zoom = phone ? ZOOM.game.tap : ZOOM[view][pose];
  await set(page, { view, pose, zoom, look: 'lambert', ref: false, ui: false, status, manual: true, tilt });
}

/** A caption in the corner of the page (large enough to read after the scaling to phone size when `phone`). */
const caption = (page: Page, text: string, phone = false): Promise<void> =>
  page.evaluate(
    ([t, px]) => {
      const id = 'anim-caption';
      const el = document.getElementById(id) ?? document.body.appendChild(Object.assign(document.createElement('div'), { id }));
      el.textContent = t;
      el.style.cssText = `position:fixed;left:8px;top:6px;z-index:99;font:600 ${px}px system-ui,sans-serif;color:#223`;
    },
    [text, phone ? 30 : 15] as const,
  );

function ffmpeg(args: string[]): void {
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.error || r.status !== 0) throw new Error(`ffmpeg failed: ${r.error?.message ?? r.stderr}`);
}

/** frames/0000.png ... -> one looping GIF with a palette of its own. Two folders: side by side. */
function encodeGif(frames: string | [string, string], file: string, scale?: number): void {
  const dirs = typeof frames === 'string' ? [frames] : frames;
  const each = scale ? `scale=${scale}:-1:flags=lanczos` : 'null';
  const join2 = dirs.length === 2 ? `[0:v]${each}[l];[1:v]${each}[r];[l][r]hstack` : `[0:v]${each}`;
  ffmpeg([
    ...dirs.flatMap((d) => ['-framerate', String(FPS), '-i', join(d, '%04d.png')]),
    '-filter_complex', `${join2},split[a][b];[a]palettegen=max_colors=${dirs.length === 2 ? 200 : 128}:stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=5`,
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
  {
    await stage(page, GIF, 'game', clip, false, true);
    const dir = await record(page, count, dt);
    const file = resolve(DIR, `${clip}_game_phone-size.gif`);
    encodeGif(dir, file, PHONE_SIZE);
    rmSync(dir, { recursive: true });
    log.push(`${clip}_game_phone-size.gif ${PHONE_SIZE} px, ${(statSync(file).size / 1024).toFixed(0)} KB`);
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

/** Record the tap demo as the page is staged; returns the frames' folder and what played. */
async function recordTaps(page: Page): Promise<{ dir: string; timeline: (AnimState & { t: number })[] }> {
  const timeline: (AnimState & { t: number })[] = [];
  const dir = await record(
    page,
    Math.round(TAP_SECONDS * FPS),
    1 / FPS,
    async (i) => {
      // the viewer's clock stands at (i - 1) / FPS here: a tap due now lands before the step into frame i
      if (TAPS.some((at) => Math.abs(at - (i - 1) / FPS) < 0.5 / FPS)) await tap(page);
    },
    async (i) => {
      timeline.push({ t: Number((i / FPS).toFixed(2)), ...(await anim(page)) });
    },
  );
  return { dir, timeline };
}

async function tapGifs(page: Page, log: string[]): Promise<void> {
  const count = Math.round(TAP_SECONDS * FPS);
  for (const view of VIEWS) {
    await stage(page, GIF, view, 'tap');
    const { dir, timeline } = await recordTaps(page);
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

/** A pair of recordings side by side, large and at phone size. `shoot` stages a page and records it. */
async function pair(name: string, log: string[], shoot: (side: 0 | 1, phone: boolean) => Promise<string>): Promise<void> {
  for (const phone of [false, true]) {
    const dirs: [string, string] = [await shoot(0, phone), await shoot(1, phone)];
    const file = resolve(DIR, `${name}${phone ? '_phone-size' : ''}.gif`);
    encodeGif(dirs, file, phone ? PHONE_SIZE : undefined);
    for (const d of dirs) rmSync(d, { recursive: true });
    log.push(`${name}${phone ? '_phone-size' : ''}.gif ${(statSync(file).size / 1024).toFixed(0)} KB`);
  }
}

/** The glide without and with the presentation tilt; with `old` (a page showing an earlier model) the before-and-after pairs too. */
async function compare(browser: Browser, page: Page, old: Page | null, info: ModelInfo, log: string[]): Promise<void> {
  const glide = info.clips.find((c) => c.name === 'glide')!;
  const count = Math.round(glide.duration * FPS);
  await pair('glide_game_tilt-off-and-on', log, async (side, phone) => {
    await stage(page, GIF, 'game', 'glide', false, phone, side ? PRESENT_TILT : 0);
    await caption(page, side ? `tilt ${PRESENT_TILT}°` : 'no tilt', phone);
    return record(page, count, glide.duration / count);
  });
  await caption(page, '');
  if (!old) return;
  const oldInfo = await old.evaluate(() => (window as ModelWindow).__joudModel!.info());
  const oldGlide = oldInfo.clips.find((c) => c.name === 'glide')!;
  const who = (side: 0 | 1): Page => (side ? page : old);
  const prepare = async (side: 0 | 1, pose: Clip | 'tap', phone: boolean, size = GIF): Promise<Page> => {
    const p = who(side);
    await stage(p, size, 'game', pose, false, phone, side ? PRESENT_TILT : 0);
    await caption(p, side ? 'after' : 'before', phone);
    return p;
  };
  await pair('before-after_glide', log, async (side, phone) => {
    const p = await prepare(side, 'glide', phone);
    const d = side ? glide.duration : oldGlide.duration; // each loop once round, in the same number of frames
    return record(p, count, d / count);
  });
  await pair('before-after_tap', log, async (side, phone) => (await recordTaps(await prepare(side, 'tap', phone))).dir);
  // stills: the poses the tips and the glide are judged in
  const POSES: [Clip, number, string][] = [
    ['idle', 0, 'idle, tucked'], ['flap', 0, 'flap, raised'], ['flap', 4, 'flap, downstroke'], ['flap', 8, 'flap, recovery'],
    ['glide', 0, 'glide'], ['fall', 0, 'fall'], ['crash', 4, 'crash, the fling'], ['crash', 14, 'crash, the end'],
  ];
  const rows: string[] = [];
  for (const phone of [false, true]) {
    for (const side of [0, 1] as const) {
      const cells: string[] = [];
      for (const [clip, frame, label] of POSES) {
        const p = await prepare(side, clip, phone, phone ? GIF : CELL);
        await caption(p, '');
        const dur = (side ? info : oldInfo).clips.find((c) => c.name === clip)!.duration;
        await seek(p, Math.min(frame / CLIP_FPS, dur));
        const shot = (await p.screenshot({ type: 'png' })).toString('base64');
        const px = phone ? PHONE_SIZE : CELL;
        cells.push(`<figure style="margin:0;width:${CELL}px;text-align:center"><img src="data:image/png;base64,${shot}" width="${px}" height="${px}" style="display:block;margin:0 auto"><figcaption>${label}</figcaption></figure>`);
      }
      rows.push(
        `<div style="margin:8px 0 2px;font-weight:600">${side ? `After: this model, leaning ${PRESENT_TILT} degrees towards the camera` : 'Before: the earlier model, no lean'}${phone ? ', at phone size' : ''}</div>` +
          `<div style="display:grid;grid-template-columns:repeat(${POSES.length},${CELL}px);gap:4px">${cells.join('')}</div>`,
      );
    }
  }
  const sheetPage = await browser.newPage({ viewport: { width: CELL * POSES.length + 4 * (POSES.length - 1) + 20, height: 400 } });
  await sheetPage.setContent(`<body style="margin:0;padding:10px;background:#fff;font:13px system-ui,sans-serif;color:#222"><h3 style="margin:2px 0 8px">Joud v2 in the game view, before and after the wing fringe, the thicker wing, the 20 degree glide and the lean</h3>${rows.join('')}</body>`, { waitUntil: 'load' });
  await sheetPage.screenshot({ path: resolve(DIR, 'before-after_poses.jpg'), type: 'jpeg', quality: 88, fullPage: true });
  await sheetPage.close();
  log.push('before-after_poses.jpg');
  for (const p of [page, old]) await caption(p, '');
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
          `<div style="margin:6px 0 2px;font-weight:600">${r.view === 'game' ? `Game view (the bird turned ${GAME_TURN} degrees and leaning ${PRESENT_TILT} degrees towards the camera, no perspective` + (clip === 'fall' ? ', root tilted 30 degrees nose down as the game does while it drops' : '') + ')' : 'Front'}</div>` +
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
    PRESENT_TILT = info.presentTilt;
    GAME_TURN = info.facingTurn;
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
    if (want('compare')) {
      const before = args.find((a) => a.startsWith('--before='))?.slice(9);
      if (before && !existsSync(before)) throw new Error(`--before: ${before} does not exist`);
      const old = before ? await openViewer(browser, GIF, GIF, resolve(before)) : null;
      await compare(browser, page, old, info, log);
      if (!old) log.push('before-and-after pairs skipped: give an earlier model with --before=<joud-v2.glb>');
    }
    for (const line of log) console.log(`[anim] ${line}`);
    console.log(`[anim] written to ${DIR}`);
    return 0;
  } finally {
    await browser.close();
    server.kill();
  }
}
