// Edge Function: replays every committed fixture in the Supabase runtime and returns the
// report as JSON. Proves the server's Deno agrees with phones before ranked runs go live.
// Not deployed in step 1.
// @ts-nocheck: the bundle is plain JS.
import { checkFixtures } from '../_shared/joud-sim.js';
import mobile from '../_shared/fixtures/mobile-1.json' with { type: 'json' };
import vr from '../_shared/fixtures/vr-1.json' with { type: 'json' };

Deno.serve(() => {
  const report = checkFixtures([mobile, vr]);
  return Response.json(
    { runtime: `deno ${Deno.version.deno} (V8 ${Deno.version.v8})`, ...report },
    { status: report.ok ? 200 : 500 },
  );
});
