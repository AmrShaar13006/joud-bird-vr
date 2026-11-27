// Screenshots of Joud's v2 model (play/?debug=1&rig=1&model=v2) next to the official art.
// Usage: npm run build && npm run model:shots   (the clips: npm run model:anim, model-anim.ts)
// Needs Playwright's Chromium: npx playwright install chromium
// (or set MODEL_CHROMIUM to another Chrome/Chromium binary).
//
// Writes docs/screens/model-v2/:
//   <view>_<pose>.jpg        the model (Lambert, as the game draws it) beside the matching art
//   toon/<view>_<pose>.jpg   the same with the proposed toon look (phone page only, not approved)
//   sheet.jpg                all Lambert shots, labelled; sheet-toon.jpg the toon ones
//   numbers.json             draw calls, triangles, fps (headless) for Lambert and toon
// fps comes from headless Chromium with software WebGL (SwiftShader): compare the two looks
// with it, but it is not a phone number.

import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Browser, chromium, type Page } from '@playwright/test';
import type { ModelApi, ModelInfo } from '../src/mobile/model-view';

const PORT = 4182;
const BASE = `https://localhost:${PORT}/play/?debug=1&rig=1&model=v2&ui=0`;
export const OUT = resolve('docs/screens/model-v2');
const W = 1280;
const H = 720;
const QUALITY = 82;

// [view, pose]: each with the art that matches it (model-view.ts referenceFor).
const SHOTS = [
  ['front', 'folded'],
  ['front', 'spread'],
  ['three-quarter', 'folded'],
  ['three-quarter', 'spread'],
  ['side', 'folded'],
  ['side', 'spread'],
  ['back', 'folded'],
  ['back', 'spread'],
  ['face', 'folded'],
  ['top', 'spread'], // from above: the green edge leads on both wings
] as const;

export type ModelWindow = Window & { __joudModel?: ModelApi };

export function startServer(): ChildProcess {
  return spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
}

export function launch(): Promise<Browser> {
  return chromium.launch({
    executablePath: process.env.MODEL_CHROMIUM || undefined,
    // WebGL without a GPU (CI, cloud containers): SwiftShader.
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
}

/** `glb`: another joud-v2.glb to show in place of the built one (model:anim's "before" pictures). */
export async function openViewer(browser: Browser, width = W, height = H, glb?: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height }, ignoreHTTPSErrors: true });
  if (glb) await page.route('**/models/joud-v2.glb', (r) => r.fulfill({ path: glb, contentType: 'model/gltf-binary' }));
  page.on('pageerror', (e) => {
    // model-gate.ts throws on purpose so the game never starts on this page.
    if (!e.message.includes('[model]')) console.error('page error:', e.message);
  });
  for (let i = 0; i < 40; i++) {
    try {
      await page.goto(BASE, { waitUntil: 'load' });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500)); // preview server still starting
    }
  }
  await page.waitForFunction(() => {
    const m = (window as ModelWindow).__joudModel;
    return !!m && (m.ready || m.error !== '');
  });
  const error = await page.evaluate(() => (window as ModelWindow).__joudModel!.error);
  if (error) throw new Error(`model view failed: ${error}`);
  return page;
}

async function shot(page: Page, opts: Parameters<ModelApi['set']>[0], file: string): Promise<void> {
  await page.evaluate((o) => (window as ModelWindow).__joudModel!.set(o), opts);
  // the reference image may still be decoding; then two frames: pose, render
  await page.evaluate(async () => {
    const img = document.querySelector('figure img') as HTMLImageElement | null;
    if (img?.src) await img.decode().catch(() => {});
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  await page.screenshot({ path: file, type: 'jpeg', quality: QUALITY });
}

/** A labelled grid of shots, rendered by the browser itself (no image library needed). */
async function sheet(browser: Browser, title: string, files: { label: string; file: string }[], file: string) {
  const img = (f: string) => `data:image/jpeg;base64,${readFileSync(f).toString('base64')}`;
  const cells = files
    .map(
      (f) =>
        `<figure style="margin:0;text-align:center"><img src="${img(f.file)}" width="${W / 2}" height="${H / 2}" style="display:block"><figcaption>${f.label}</figcaption></figure>`,
    )
    .join('');
  const html =
    `<body style="margin:0;padding:8px;background:#fff;font:14px system-ui,sans-serif;color:#222">` +
    `<h3 style="margin:4px 0 8px">${title}</h3>` +
    `<div style="display:grid;grid-template-columns:repeat(2,${W / 2}px);gap:8px">${cells}</div></body>`;
  const page = await browser.newPage({ viewport: { width: W + 32, height: 400 } });
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path: file, type: 'jpeg', quality: QUALITY, fullPage: true });
  await page.close();
}

async function measure(page: Page, look: 'lambert' | 'toon'): Promise<ModelInfo> {
  await page.evaluate((l) => (window as ModelWindow).__joudModel!.set({ look: l, ref: false, view: 'three-quarter', pose: 'glide' }), look);
  await page.waitForTimeout(3000);
  return page.evaluate(() => (window as ModelWindow).__joudModel!.info());
}

export async function main(): Promise<number> {
  const server = startServer();
  const browser = await launch();
  try {
    const page = await openViewer(browser);
    mkdirSync(resolve(OUT, 'toon'), { recursive: true });
    const lambert: { label: string; file: string }[] = [];
    const toon: { label: string; file: string }[] = [];
    for (const [view, pose] of SHOTS) {
      const name = `${view}_${pose}.jpg`;
      await shot(page, { view, pose, look: 'lambert', ref: true }, resolve(OUT, name));
      await shot(page, { view, pose, look: 'toon', ref: true }, resolve(OUT, 'toon', name));
      lambert.push({ label: `${view}, wings ${pose}`, file: resolve(OUT, name) });
      toon.push({ label: `${view}, wings ${pose} (toon)`, file: resolve(OUT, 'toon', name) });
    }
    await sheet(browser, 'Joud v2 (Lambert, as in the game) beside the official art', lambert, resolve(OUT, 'sheet.jpg'));
    await sheet(browser, 'Joud v2, proposed toon look (phone page only; needs OK)', toon, resolve(OUT, 'sheet-toon.jpg'));

    const numbers = { lambert: await measure(page, 'lambert'), toon: await measure(page, 'toon') };
    const report = { ...numbers, note: 'headless Chromium with SwiftShader (software WebGL): fps only compares the looks' };
    writeFileSync(resolve(OUT, 'numbers.json'), `${JSON.stringify(report, null, 1)}\n`);
    for (const [k, n] of Object.entries(numbers)) {
      console.log(`[model] ${k.padEnd(7)} draw calls ${n.calls}, triangles ${n.triangles}, fps ${n.fps} (headless), ${(n.bytes / 1024).toFixed(0)} KB`);
    }
    console.log(`[model] ${SHOTS.length * 2} shots + 2 sheets in ${OUT}`);
    return 0;
  } finally {
    await browser.close();
    server.kill();
  }
}
