// npm run check:mobile (after npm run build)
// Proves from the build output that play/ loads no IWSDK code and no IWER emulator, and
// prints the gzipped size of everything the page loads.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = resolve('dist');
const REPORT = resolve('.tmp/build/chunk-modules.json');
const BANNED = [/@iwsdk\//, /node_modules\/elics\//, /@pmndrs\//, /@drawcall\//, /iwer/i, /havok/i, /src\/systems\//, /src\/components/, /src\/index\.ts/];

if (!existsSync(REPORT)) {
  console.error('No chunk report: run `npm run build` first.');
  process.exit(1);
}
const chunks = JSON.parse(readFileSync(REPORT, 'utf8'));
const html = readFileSync(resolve(DIST, 'play/index.html'), 'utf8');

// Entry files referenced by the page (module script + modulepreload + css).
const refs = [...html.matchAll(/(?:src|href)="\.\.\/(assets\/[^"]+)"/g)].map((m) => m[1]);
const queue = refs.filter((r) => r.endsWith('.js'));
const seen = new Set();
const modules = new Set();
while (queue.length) {
  const f = queue.shift();
  if (seen.has(f)) continue;
  seen.add(f);
  const c = chunks[f];
  if (!c) throw new Error(`chunk ${f} not in the report`);
  for (const m of c.modules) modules.add(m);
  queue.push(...c.imports, ...c.dynamicImports);
}

const bad = [...modules].filter((m) => BANNED.some((re) => re.test(m)));
const htmlBad = /iwer|@iwsdk|xr-emulator|injectIWER/i.test(html);

let rawTotal = 0;
let gzTotal = 0;
const rows = [];
for (const f of [...seen, ...refs.filter((r) => r.endsWith('.css'))]) {
  const buf = readFileSync(resolve(DIST, f));
  const gz = gzipSync(buf, { level: 9 }).length;
  rawTotal += buf.length;
  gzTotal += gz;
  rows.push([f, buf.length, gz]);
}
const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
console.log('play/ loads:');
for (const [f, raw, gz] of rows) console.log(`  ${f.padEnd(44)} ${kb(raw).padStart(10)}  gzip ${kb(gz).padStart(9)}`);
const glb = existsSync(resolve(DIST, 'models/joud.glb')) ? readFileSync(resolve(DIST, 'models/joud.glb')).length : 0;
console.log(`  JS + CSS total: ${kb(rawTotal)}, gzip ${kb(gzTotal)} (+ models/joud.glb ${kb(glb)}, binary)`);
console.log(`  ${modules.size} source modules in the play/ graph`);
console.log(bad.length ? `FAIL IWSDK/IWER modules in play/: ${bad.join(', ')}` : 'PASS no IWSDK, uikit or IWER modules in the play/ chunk graph');
console.log(htmlBad ? 'FAIL play/index.html mentions IWER/IWSDK' : 'PASS no IWER emulator injected into dist/play/index.html');
process.exitCode = bad.length || htmlBad ? 1 : 0;
