// Replays the committed fixtures on the real Supabase Edge runtime: posts
// src/core/fixtures/*.json to the deployed `sim-selftest` function and prints its report.
//   SUPABASE_STAGING_URL=https://<ref>.supabase.co SUPABASE_STAGING_ANON_KEY=<anon JWT> \
//     node scripts/determinism/edge-selftest.mjs
// `npm run test:determinism` runs it as a row when both variables are set.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const FIXTURE_FILES = ['mobile-1.json', 'vr-1.json'];

/** Returns { ok, passed, total, runtime, failures } or throws on a network/HTTP error. */
export async function edgeSelftest(url, anonKey) {
  const files = FIXTURE_FILES.map((n) => JSON.parse(readFileSync(resolve('src/core/fixtures', n), 'utf8')));
  const res = await fetch(`${url.replace(/\/$/, '')}/functions/v1/sim-selftest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${anonKey}`, apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(files),
  });
  const text = await res.text();
  let report;
  try {
    report = JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  if (typeof report.total !== 'number') throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  return {
    ok: report.ok === true,
    passed: report.passed,
    total: report.total,
    runtime: report.runtime,
    failures: [...(report.hashErrors ?? []), ...(report.lines ?? []).filter((l) => l.startsWith('FAIL'))],
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.SUPABASE_STAGING_URL;
  const key = process.env.SUPABASE_STAGING_ANON_KEY;
  if (!url || !key) {
    console.error('Set SUPABASE_STAGING_URL and SUPABASE_STAGING_ANON_KEY.');
    process.exit(2);
  }
  const r = await edgeSelftest(url, key);
  for (const f of r.failures) console.log(f);
  console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.passed}/${r.total} on ${r.runtime}`);
  process.exitCode = r.ok ? 0 : 1;
}
