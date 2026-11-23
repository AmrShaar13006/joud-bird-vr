// npm run test:determinism
//   1. Node (Vitest): fixtures, ruleset hashes, live-vs-replay, sim bundle up to date
//   2. Node: the committed sim bundle replays every fixture
//   3. Deno: the same bundle (what Supabase Edge Functions run)
//   4. Chromium and WebKit (Playwright): the built check/ page
// Prints one table, runtime × runs passed. Exit code 1 if anything failed.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const TMP = resolve('.tmp/determinism');
const rows = [];
let failed = false;
// Tools are spawned through node itself: no shell, so paths with spaces are safe.
const NODE_BIN = {
  vitest: 'node_modules/vitest/vitest.mjs',
  vite: 'node_modules/vite/bin/vite.js',
  playwright: 'node_modules/@playwright/test/cli.js',
};

function sh(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const bin = NODE_BIN[cmd];
  const [exe, argv] = bin ? [process.execPath, [resolve(bin), ...args]] : [cmd, args];
  return spawnSync(exe, argv, { stdio: opts.capture ? 'pipe' : 'inherit', encoding: 'utf8' });
}

function row(runtime, passed, total, note = '') {
  const ok = total > 0 && passed === total;
  if (!ok) failed = true;
  rows.push({ runtime, result: `${passed}/${total}`, status: ok ? 'PASS' : 'FAIL', note });
}

rmSync(TMP, { recursive: true, force: true });

// 1. Vitest: fixtures + live vs replay + bundle up to date.
const vitestJson = resolve(TMP, 'vitest.json');
const v = sh('vitest', [
  'run', 'src/core/determinism.test.ts', 'src/core/sim-bundle.test.ts',
  '--reporter=default', '--reporter=json', `--outputFile.json=${vitestJson}`,
]);
if (existsSync(vitestJson)) {
  const results = JSON.parse(readFileSync(vitestJson, 'utf8')).testResults.flatMap((f) => f.assertionResults);
  const fixtures = results.filter((t) => t.ancestorTitles.includes('fixtures (Node)') && t.title.endsWith('replays identically'));
  row('Node (src/core, Vitest)', fixtures.filter((t) => t.status === 'passed').length, fixtures.length, 'fixture runs');
  const live = results.filter((t) => t.ancestorTitles.some((a) => a.startsWith('live play replays')));
  row('Node (live vs replay)', live.filter((t) => t.status === 'passed').length * 500, live.length * 500, 'random frame times, 500 seeds × mode × ruleset');
  const bundle = results.filter((t) => t.title.startsWith('is up to date'));
  row('Sim bundle up to date', bundle.filter((t) => t.status === 'passed').length, bundle.length, 'npm run build:sim');
  const other = results.filter((t) => !fixtures.includes(t) && !live.includes(t) && !bundle.includes(t));
  row('Node (hash, coverage checks)', other.filter((t) => t.status === 'passed').length, other.length, 'tests');
} else {
  row('Node (src/core, Vitest)', 0, 1, `vitest exited ${v.status}`);
}

// 2. Node on the committed bundle.
const sim = await import(pathToFileURL(resolve('supabase/functions/_shared/joud-sim.js')).href);
const fx = (n) => JSON.parse(readFileSync(resolve('supabase/functions/_shared/fixtures', n), 'utf8'));
const nodeReport = sim.checkFixtures([fx('mobile-1.json'), fx('vr-1.json')]);
for (const l of nodeReport.lines) if (l.startsWith('FAIL')) console.log(l);
row(`Node ${process.version} (sim bundle)`, nodeReport.ok ? nodeReport.passed : Math.min(nodeReport.passed, nodeReport.total - 1), nodeReport.total, 'fixture runs');

// 3. Deno.
const deno = sh('deno', ['--version'], { capture: true });
if (deno.status !== 0) {
  console.log('\nDeno is not installed. Install it, then rerun:');
  console.log('  Windows:      winget install --id DenoLand.Deno');
  console.log('  macOS/Linux:  curl -fsSL https://deno.land/install.sh | sh');
  rows.push({ runtime: 'Deno', result: '-', status: 'SKIPPED', note: 'deno not installed' });
  failed = true;
} else {
  const d = sh('deno', ['run', 'scripts/determinism/deno-check.ts'], { capture: true });
  const out = `${d.stdout}${d.stderr}`;
  for (const l of out.split('\n')) if (l.startsWith('FAIL')) console.log(l);
  const m = out.match(/^RESULT (.*)$/m);
  const ver = (deno.stdout.match(/deno (\S+)/) || [])[1] ?? '';
  if (m) {
    const r = JSON.parse(m[1]);
    row(`Deno ${ver} (sim bundle)`, r.ok ? r.passed : Math.min(r.passed, r.total - 1), r.total, 'fixture runs');
  } else {
    console.log(out);
    row(`Deno ${ver}`, 0, 1, `exit ${d.status}`);
  }
}

// 4. Browsers.
if (!existsSync(resolve('node_modules/@playwright/test/package.json'))) {
  console.log('\n@playwright/test is not installed: npm install -D --save-exact @playwright/test@1.65.1');
  rows.push({ runtime: 'Chromium / WebKit', result: '-', status: 'SKIPPED', note: '@playwright/test not installed' });
  failed = true;
} else {
  const b = sh('vite', ['build', '--logLevel', 'warn']);
  if (b.status !== 0) {
    row('Browsers (build)', 0, 1, 'vite build failed');
  } else {
    sh('playwright', ['test']);
    for (const project of ['chromium', 'webkit', 'webkit-iphone']) {
      const f = resolve(TMP, `${project}.json`);
      if (!existsSync(f)) {
        row(project, 0, 1, 'no report');
        continue;
      }
      const r = JSON.parse(readFileSync(f, 'utf8'));
      const engine = (r.userAgent.match(/(Chrome|Version)\/[\d.]+/) || [''])[0];
      row(`${project} ${engine}`.trim(), r.ok ? r.passed : Math.min(r.passed, r.total - 1), r.total, `check/ page, ${r.ms} ms`);
    }
  }
}

// Table.
const w = [32, 12, 8];
const line = (a, b, c, d) => `| ${a.padEnd(w[0])} | ${b.padEnd(w[1])} | ${c.padEnd(w[2])} | ${d}`;
console.log('\nDeterminism: runtime × runs passed');
console.log(line('Runtime', 'Passed', 'Status', 'What'));
console.log(line('-'.repeat(w[0]), '-'.repeat(w[1]), '-'.repeat(w[2]), '---'));
for (const r of rows) console.log(line(r.runtime, r.result, r.status, r.note));
process.exitCode = failed ? 1 : 0;
