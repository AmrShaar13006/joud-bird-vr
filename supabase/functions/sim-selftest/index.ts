// Edge Function: replays the fixture files sent in the request body in the Supabase runtime
// and returns the report as JSON. Proves the server's Deno agrees with phones before ranked
// runs go live. `node scripts/determinism/edge-selftest.mjs` posts the committed fixtures
// (src/core/fixtures/*.json) and prints the result; `npm run test:determinism` adds it as a
// row when SUPABASE_STAGING_URL and SUPABASE_STAGING_ANON_KEY are set.
// Deploy to staging only: replays cost CPU, so production doesn't need this endpoint.
// @ts-nocheck: the bundle is plain JS.
import { checkFixtures } from '../_shared/joud-sim.js';

const MAX_BODY = 256 * 1024;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return Response.json({ error: 'POST fixture files' }, { status: 405 });
  const text = await req.text();
  if (text.length > MAX_BODY) return Response.json({ error: 'body too large' }, { status: 413 });
  let files;
  try {
    files = JSON.parse(text);
  } catch {
    return Response.json({ error: 'bad JSON' }, { status: 400 });
  }
  if (!Array.isArray(files)) return Response.json({ error: 'expected an array of fixture files' }, { status: 400 });
  const report = checkFixtures(files);
  return Response.json(
    { runtime: `deno ${Deno.version.deno} (V8 ${Deno.version.v8})`, ...report },
    { status: report.ok ? 200 : 500 },
  );
});
