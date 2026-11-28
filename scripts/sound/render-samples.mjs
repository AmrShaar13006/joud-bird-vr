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
  // The flap (the first version's): 6 taps, the last 3 quick.
  'flap-classic': { dur: 2.0, play: [0, 0.4, 0.8, 1.2, 1.4, 1.6].map((at) => ({ cue: 'flap', at })) },
  'point-1-chime': { dur: 0.6, play: [{ cue: 'point' }] },
  'run-12-points-climbing': { dur: 4.6, play: Array.from({ length: 12 }, (_, i) => ({ cue: 'point', at: i * 0.35, run: i + 1 })) },
  'point-2': { dur: 0.7, play: [{ cue: 'point2' }] },
  'point-3-tweet': { dur: 0.7, play: [{ cue: 'point3' }] },
  'point-5-trill': { dur: 0.9, play: [{ cue: 'point5' }] },
  'flower-bloom': { dur: 0.6, play: [{ cue: 'bloom' }] },
  'hit': { dur: 0.8, play: [{ cue: 'hit' }] },
  'new-best': { dur: 1.6, play: [{ cue: 'best' }] },
  'hit-then-new-best': { dur: 1.7, play: [{ cue: 'hit' }, { cue: 'best' }] },
  'button-tick': { dur: 0.2, play: [{ cue: 'tick' }] },
  'stress-overlap': {
    dur: 2.0,
    play: [
      { cue: 'flap' }, { cue: 'point', at: 0.01 }, { cue: 'flap', at: 0.05 }, { cue: 'point5', at: 0.06 },
      { cue: 'bloom', at: 0.08 }, { cue: 'flap', at: 0.1 }, { cue: 'hit', at: 0.12 }, { cue: 'best', at: 0.12 },
    ],
  },
  // A short round as a player hears it: flaps, points climbing, +3, a flower, +5, crash, new best.
  'round-demo': {
    dur: 9.5,
    play: (() => {
      const out = [];
      for (let i = 0; i < 24; i++) out.push({ cue: 'flap', at: i * 0.32 + (i % 3) * 0.04, rate: 0.97 + ((i * 7) % 6) / 100 });
      const pts = [['point', 0.8], ['point', 1.6], ['point3', 2.4], ['point', 3.2], ['bloom', 3.5], ['point2', 4.0], ['point', 4.8], ['point5', 5.6], ['point', 6.4], ['point', 7.2]];
      let run = 0;
      for (const [cue, at] of pts) out.push({ cue, at, run: cue === 'bloom' ? run : ++run });
      out.push({ cue: 'hit', at: 7.75 }, { cue: 'best', at: 7.75 });
      return out;
    })(),
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
          else S.playCue(kit, p.cue, LEAD + (p.at ?? 0), p.voice ?? 'classic', p.rate ?? 1, p.run ?? 1);
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
