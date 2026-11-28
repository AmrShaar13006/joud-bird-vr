// Screenshots of Joud's rig prototype (play/?debug=1&rig=1) for the shoulder review.
// Usage: npm run build && npm run rig:shots
// Needs Playwright's Chromium: npx playwright install chromium
// (or set RIG_CHROMIUM to another Chrome/Chromium binary).
//
// Writes docs/screens/rig/:
//   narrow/<view>_<pose>.jpg   4 views × 6 poses, shoulder blend |x| 0.45-0.55 (the default)
//   wide/<view>_<pose>.jpg     4 views × folded, -60, +60, shoulder blend |x| 0.40-0.60
//   <blend>/shoulder-<l|r>_<pose>.jpg   close-ups of each shoulder at +60, -60 and folded
//   sheet-narrow.jpg, sheet-wide.jpg, sheet-shoulders.jpg   labelled contact sheets
// and prints the debug overlay's draw calls and fps (headless, so fps is only indicative).

import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Browser, chromium, type Page } from '@playwright/test';

const PORT = 4181;
const BASE = `https://localhost:${PORT}/play/?debug=1&rig=1&ui=0`;
const OUT = resolve('docs/screens/rig');
const SIZE = 640;
const QUALITY = 80;

const VIEWS = ['front', 'three-quarter', 'side', 'back'] as const;
const POSES = ['folded', '-60', '-30', '0', '30', '60'] as const;
const COMPARE_POSES = ['folded', '-60', '60'] as const;
const CLOSE_UPS = ['shoulder-l', 'shoulder-r'] as const;
const BLENDS = ['narrow', 'wide'] as const;

type RigWindow = Window & {
  __joudRig?: {
    ready: boolean;
    error: string;
    set(o: Record<string, unknown>): void;
    info(): { calls: number; triangles: number; fps: number; rig: string };
    penetration(): { vertices: number; deepest: number };
  };
};

function startServer(): ChildProcess {
  return spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
}

async function openRig(browser: Browser): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, ignoreHTTPSErrors: true });
  page.on('pageerror', (e) => {
    // rig-gate.ts throws on purpose so the game never starts on this page.
    if (!e.message.includes('[rig]')) console.error('page error:', e.message);
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
    const r = (window as RigWindow).__joudRig;
    return !!r && (r.ready || r.error !== '');
  });
  const error = await page.evaluate(() => (window as RigWindow).__joudRig!.error);
  if (error) throw new Error(`rig view failed: ${error}`);
  return page;
}

async function shot(page: Page, opts: Record<string, string>, file: string): Promise<void> {
  await page.evaluate((o) => (window as RigWindow).__joudRig!.set(o), opts);
  // two frames: one to pose, one to render it
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: file, type: 'jpeg', quality: QUALITY });
}

/** A labelled grid of shots, rendered by the browser itself (no image library needed). */
async function sheet(browser: Browser, rows: { label: string; files: { label: string; file: string }[] }[], file: string) {
  const cols = Math.max(...rows.map((r) => r.files.length));
  const cell = 240;
  const img = (f: string) => `data:image/jpeg;base64,${readFileSync(f).toString('base64')}`;
  const html =
    `<body style="margin:0;background:#fff;font:14px system-ui,sans-serif;color:#222">` +
    `<table style="border-collapse:collapse">` +
    rows
      .map(
        (r) =>
          `<tr><th style="padding:4px 8px;text-align:right;white-space:nowrap">${r.label}</th>` +
          r.files
            .map(
              (f) =>
                `<td style="padding:2px;text-align:center"><img src="${img(f.file)}" width="${cell}" height="${cell}" style="display:block"><div>${f.label}</div></td>`,
            )
            .join('') +
          `</tr>`,
      )
      .join('') +
    `</table></body>`;
  const page = await browser.newPage({ viewport: { width: 140 + cols * (cell + 4), height: 200 } });
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path: file, type: 'jpeg', quality: QUALITY, fullPage: true });
  await page.close();
}

export async function main(): Promise<number> {
  const server = startServer();
  const browser = await chromium.launch({
    executablePath: process.env.RIG_CHROMIUM || undefined,
    // WebGL without a GPU (CI, cloud containers): SwiftShader.
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  try {
    const page = await openRig(browser);
    const files: Record<string, string> = {};
    for (const blend of BLENDS) {
      mkdirSync(resolve(OUT, blend), { recursive: true });
      const poses = blend === 'narrow' ? POSES : COMPARE_POSES;
      for (const view of VIEWS) {
        for (const pose of poses) {
          const f = resolve(OUT, blend, `${view}_${pose}.jpg`);
          await shot(page, { blend, view, pose }, f);
          files[`${blend}/${view}/${pose}`] = f;
        }
      }
      for (const view of CLOSE_UPS) {
        for (const pose of COMPARE_POSES) {
          const f = resolve(OUT, blend, `${view}_${pose}.jpg`);
          await shot(page, { blend, view, pose }, f);
          files[`${blend}/${view}/${pose}`] = f;
        }
      }
    }

    // Wing vertices pushed inside the body, per blend and pose.
    const penetration: Record<string, { vertices: number; deepest: number }> = {};
    for (const blend of BLENDS) {
      for (const pose of POSES) {
        penetration[`${blend} ${pose}`] = await page.evaluate(
          (o) => {
            const r = (window as RigWindow).__joudRig!;
            r.set(o);
            return r.penetration();
          },
          { blend, pose },
        );
      }
    }

    // Overlay numbers: draw calls and fps after 2 s on the front view with the beat loop.
    await page.evaluate(() => (window as RigWindow).__joudRig!.set({ blend: 'narrow', view: 'front', pose: 'beat', ui: true }));
    await page.waitForTimeout(2500);
    const info = await page.evaluate(() => (window as RigWindow).__joudRig!.info());
    await page.screenshot({ path: resolve(OUT, 'overlay.jpg'), type: 'jpeg', quality: QUALITY });

    const label = (p: string) => (p === 'folded' ? 'folded' : `${Number(p) > 0 ? '+' : ''}${p}°`);
    await sheet(
      browser,
      VIEWS.map((v) => ({ label: v, files: POSES.map((p) => ({ label: label(p), file: files[`narrow/${v}/${p}`] })) })),
      resolve(OUT, 'sheet-narrow.jpg'),
    );
    await sheet(
      browser,
      VIEWS.map((v) => ({
        label: v,
        files: COMPARE_POSES.flatMap((p) => [
          { label: `${label(p)} 0.45-0.55`, file: files[`narrow/${v}/${p}`] },
          { label: `${label(p)} 0.40-0.60`, file: files[`wide/${v}/${p}`] },
        ]),
      })),
      resolve(OUT, 'sheet-wide.jpg'),
    );
    await sheet(
      browser,
      CLOSE_UPS.flatMap((v) =>
        BLENDS.map((b) => ({
          label: `${v} ${b === 'narrow' ? '0.45-0.55' : '0.40-0.60'}`,
          files: COMPARE_POSES.map((p) => ({ label: label(p), file: files[`${b}/${v}/${p}`] })),
        })),
      ),
      resolve(OUT, 'sheet-shoulders.jpg'),
    );

    const report = { ...info, penetration, note: 'headless Chromium with SwiftShader (software WebGL): fps is not a device number' };
    writeFileSync(resolve(OUT, 'overlay.json'), `${JSON.stringify(report, null, 1)}\n`);
    console.log(`[rig] ${info.rig}`);
    console.log(`[rig] draw calls ${info.calls}, triangles ${info.triangles}, fps ${info.fps} (headless, software WebGL)`);
    for (const [k, p] of Object.entries(penetration)) {
      console.log(`[rig] inside body ${k.padEnd(14)} ${String(p.vertices).padStart(4)} vertices, deepest ${p.deepest}`);
    }
    console.log(`[rig] ${Object.keys(files).length} shots + 3 sheets in ${OUT}`);
    return 0;
  } finally {
    await browser.close();
    server.kill();
  }
}
