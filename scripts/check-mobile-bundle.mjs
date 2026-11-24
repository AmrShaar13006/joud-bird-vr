// npm run check:mobile (after npm run build)
// Proves from the build output that:
//   - play/ loads no IWSDK code and no IWER emulator;
//   - play/ loads supabase-js only lazily (not before the first frame);
//   - the VR pages (index.html, fallback.html) never load supabase-js or the phone's net code;
//   - play/ first load (JS + CSS before the first frame) stays under its 250 kB gzip budget.
//     Lazy chunks (supabase-js, the debug autopilot) load later and are reported, not budgeted.
// Prints the gzipped size of everything play/ loads.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = resolve('dist');
const REPORT = resolve('.tmp/build/chunk-modules.json');
const BANNED = [/@iwsdk\//, /node_modules\/elics\//, /@pmndrs\//, /@drawcall\//, /iwer/i, /havok/i, /src\/systems\//, /src\/components/, /src\/index\.ts/];
const SERVER = [/@supabase\//, /src\/mobile\/net\.ts/];
const BUDGET_GZ = 250 * 1024;

if (!existsSync(REPORT)) {
  console.error('No chunk report: run `npm run build` first.');
  process.exit(1);
}
const chunks = JSON.parse(readFileSync(REPORT, 'utf8'));

/** Chunks and source modules reachable from a page (static imports only, or all). */
function graph(htmlFile, prefix, withDynamic) {
  const html = readFileSync(resolve(DIST, htmlFile), 'utf8');
  const re = new RegExp(`(?:src|href)="${prefix.replace(/[./]/g, '\\$&')}(assets/[^"]+)"`, 'g');
  const refs = [...html.matchAll(re)].map((m) => m[1]);
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
    queue.push(...c.imports, ...(withDynamic ? c.dynamicImports : []));
  }
  return { html, refs, seen, modules };
}

const play = graph('play/index.html', '../', true);
const playFirst = graph('play/index.html', '../', false);
const bad = [...play.modules].filter((m) => BANNED.some((re) => re.test(m)));
const htmlBad = /iwer|@iwsdk|xr-emulator|injectIWER/i.test(play.html);
const eagerServer = [...playFirst.modules].filter((m) => SERVER.some((re) => re.test(m)));
const lazyServer = [...play.modules].some((m) => /@supabase\//.test(m));
const vrServer = ['index.html', 'fallback.html'].flatMap((p) =>
  [...graph(p, './', true).modules].filter((m) => SERVER.some((re) => re.test(m))).map((m) => `${p}: ${m}`),
);

let rawTotal = 0;
let gzTotal = 0;
let gzFirst = 0;
const rows = [];
for (const f of [...play.seen, ...play.refs.filter((r) => r.endsWith('.css'))]) {
  const buf = readFileSync(resolve(DIST, f));
  const gz = gzipSync(buf, { level: 9 }).length;
  rawTotal += buf.length;
  gzTotal += gz;
  const first = playFirst.seen.has(f) || f.endsWith('.css');
  if (first) gzFirst += gz;
  rows.push([f, buf.length, gz, first ? '' : '(lazy)']);
}
const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
console.log('play/ loads:');
for (const [f, raw, gz, note] of rows) console.log(`  ${f.padEnd(44)} ${kb(raw).padStart(10)}  gzip ${kb(gz).padStart(9)} ${note}`);
const glb = existsSync(resolve(DIST, 'models/joud.glb')) ? readFileSync(resolve(DIST, 'models/joud.glb')).length : 0;
console.log(`  JS + CSS total: ${kb(rawTotal)}, gzip ${kb(gzTotal)} (first load ${kb(gzFirst)}; + models/joud.glb ${kb(glb)}, binary)`);
console.log(`  ${play.modules.size} source modules in the play/ graph`);

const checks = [
  [bad.length === 0, 'no IWSDK, uikit or IWER modules in the play/ chunk graph', `IWSDK/IWER modules in play/: ${bad.join(', ')}`],
  [!htmlBad, 'no IWER emulator injected into dist/play/index.html', 'play/index.html mentions IWER/IWSDK'],
  [eagerServer.length === 0, 'supabase-js and net.ts are not in play/\'s first load', `loaded before the first frame: ${eagerServer.join(', ')}`],
  // Built without VITE_SUPABASE_URL, the server code is dropped: ranked play is off (all practice).
  process.env.VITE_SUPABASE_URL
    ? [lazyServer, 'supabase-js is in play/\'s lazy chunks', 'supabase-js missing from play/ (ranked play cannot work)']
    : [true, `ranked play is ${lazyServer ? 'on' : 'off'} in this build (VITE_SUPABASE_URL not set for the check)`, ''],
  [vrServer.length === 0, 'index.html and fallback.html never load supabase-js', `VR pages load server code: ${vrServer.join(', ')}`],
  [gzFirst <= BUDGET_GZ, `play/ first load ${kb(gzFirst)} gzip, within ${kb(BUDGET_GZ)} (with lazy chunks ${kb(gzTotal)})`, `play/ first load ${kb(gzFirst)} gzip, over the ${kb(BUDGET_GZ)} budget`],
];
for (const [ok, pass, fail] of checks) console.log(ok ? `PASS ${pass}` : `FAIL ${fail}`);
process.exitCode = checks.every(([ok]) => ok) ? 0 : 1;
