// npm run sound:samples — render every phone-game sound offline to .wav, plus the 20-second
// percussion preview, through the same master gain and limiter as the game. Prints each
// file's peak and loudest 50 ms (RMS) before and after the limiter. Each render starts the
// sounds 0.3 s in and trims that lead-in, so the limiter has settled as it has in a running
// game. Fails if anything clips. Output: .tmp/sound/ (not committed).
// Uses Playwright's Chromium (OfflineAudioContext); set SOUND_CHROMIUM to pick a binary.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build } from 'vite';

const OUT = resolve('.tmp/sound');
const RATE = 44100;
const LEAD = 0.3;

const bundle = await build({
  configFile: false,
  logLevel: 'warn',
  build: {
    write: false,
    minify: false,
    target: 'esnext',
    lib: { entry: resolve('scripts/sound/render-entry.ts'), formats: ['iife'], name: 'JoudSound', fileName: 'sound' },
  },
});
const code = (Array.isArray(bundle) ? bundle : [bundle]).flatMap((o) => o.output).find((o) => o.type === 'chunk').code;

// name → seconds and what plays (cue names from director.ts; `at` in seconds; `rate` pitch factor).
const SAMPLES = {
  'flap-whoosh': { dur: 0.5, play: [{ cue: 'flap', voice: 'whoosh' }] },
  'flap-blip': { dur: 0.5, play: [{ cue: 'flap', voice: 'blip' }] },
  'point-pop': { dur: 0.4, play: [{ cue: 'pop' }] },
  'point-pop-x5-variation': { dur: 1.6, play: [0.97, 1.0, 1.03, 0.985, 1.015].map((rate, i) => ({ cue: 'pop', at: i * 0.28, rate })) },
  'plus3-roll': { dur: 0.8, play: [{ cue: 'roll3' }] },
  'plus5-roll': { dur: 1.0, play: [{ cue: 'roll5' }] },
  'flower-sparkle': { dur: 0.6, play: [{ cue: 'sparkle' }] },
  'hit': { dur: 0.9, play: [{ cue: 'hit' }] },
  'new-best': { dur: 1.8, play: [{ cue: 'best' }] },
  'hit-then-new-best': { dur: 2.0, play: [{ cue: 'hit' }, { cue: 'best' }] },
  'button-tick': { dur: 0.2, play: [{ cue: 'tick' }] },
  'stress-overlap': {
    dur: 2.2,
    play: [
      { cue: 'flap' }, { cue: 'pop', at: 0.01 }, { cue: 'flap', at: 0.05 }, { cue: 'roll5', at: 0.06 },
      { cue: 'sparkle', at: 0.08 }, { cue: 'flap', at: 0.1 }, { cue: 'hit', at: 0.12 }, { cue: 'best', at: 0.12 },
    ],
  },
  'percussion-preview-20s': { dur: 20.5, preview: true },
};

const browser = await chromium.launch(process.env.SOUND_CHROMIUM ? { executablePath: process.env.SOUND_CHROMIUM } : {});
const page = await browser.newPage();
await page.setContent('<!doctype html><title>sound</title>');
await page.addScriptTag({ content: code });

mkdirSync(OUT, { recursive: true });
const rows = [];
for (const [name, spec] of Object.entries(SAMPLES)) {
  const r = await page.evaluate(
    async ({ spec, RATE, LEAD }) => {
      const S = window.JoudSound;
      async function render(limit) {
        const ctx = new OfflineAudioContext(1, Math.ceil((spec.dur + LEAD) * RATE), RATE);
        const master = S.masterChain(ctx, limit);
        const kit = { ctx, out: master, noise: S.makeNoise(ctx) };
        if (spec.preview) S.schedulePreview(kit, LEAD);
        for (const p of spec.play ?? []) {
          if (p.cue === 'tick') S.tick(kit, LEAD + (p.at ?? 0));
          else S.playCue(kit, p.cue, LEAD + (p.at ?? 0), p.voice ?? 'whoosh', p.rate ?? 1);
        }
        return (await ctx.startRendering()).getChannelData(0).subarray(Math.round(LEAD * RATE));
      }
      const peakOf = (d) => d.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      const rmsOf = (d) => {
        const w = Math.round(0.05 * RATE);
        let best = 0;
        for (let i = 0; i + w <= d.length; i += w >> 2) {
          let sum = 0;
          for (let j = i; j < i + w; j++) sum += d[j] * d[j];
          best = Math.max(best, Math.sqrt(sum / w));
        }
        return best;
      };
      const dry = await render(false);
      const raw = peakOf(dry);
      const rawRms = rmsOf(dry);
      const data = await render(true);
      // 16-bit PCM WAV, base64.
      const pcm = new Int16Array(data.length);
      for (let i = 0; i < data.length; i++) pcm[i] = Math.max(-1, Math.min(1, data[i])) * 0x7fff;
      const buf = new ArrayBuffer(44 + pcm.byteLength);
      const v = new DataView(buf);
      const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
      str(0, 'RIFF'); v.setUint32(4, 36 + pcm.byteLength, true); str(8, 'WAVE'); str(12, 'fmt ');
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, RATE, true);
      v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data');
      v.setUint32(40, pcm.byteLength, true);
      new Uint8Array(buf, 44).set(new Uint8Array(pcm.buffer));
      let bin = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { raw, rawRms, peak: peakOf(data), rms: rmsOf(data), wav: btoa(bin) };
    },
    { spec, RATE, LEAD },
  );
  writeFileSync(resolve(OUT, `${name}.wav`), Buffer.from(r.wav, 'base64'));
  rows.push([name, r.raw, r.rawRms, r.peak, r.rms]);
}
await browser.close();

const db = (x) => (x > 0 ? (20 * Math.log10(x)).toFixed(1) : '-inf');
console.log(`Rendered ${rows.length} files to ${OUT}`);
console.log('dBFS'.padEnd(26), 'no limiter: peak'.padStart(17), 'loudest 50 ms'.padStart(14), '| game: peak'.padStart(12), 'loudest 50 ms'.padStart(14));
for (const [n, ...v] of rows) {
  const [a, b, c, d] = v.map(db);
  console.log(n.padEnd(26), a.padStart(17), b.padStart(14), `| ${c.padStart(10)}`, d.padStart(14));
}
writeFileSync(
  resolve(OUT, 'levels.json'),
  JSON.stringify(rows.map(([file, ...v]) => ({ file, ...Object.fromEntries(['rawPeak', 'rawLoud50ms', 'gamePeak', 'gameLoud50ms'].map((k, i) => [k, +db(v[i])])) })), null, 1),
);
const clipped = rows.filter(([, , , p]) => p >= 1);
if (clipped.length) {
  console.error(`FAIL clipped: ${clipped.map(([n]) => n).join(', ')}`);
  process.exitCode = 1;
}
