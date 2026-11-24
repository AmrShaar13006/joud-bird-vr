// Deno: replay every fixture through the committed sim bundle (what the Edge Functions run).
// deno run scripts/determinism/deno-check.ts   → PASS/FAIL per run, exit code 1 on any failure.
// @ts-nocheck: the bundle is plain JS; Deno type-checks nothing here.
import { checkFixtures } from '../../supabase/functions/_shared/joud-sim.js';
import mobile from '../../supabase/functions/_shared/fixtures/mobile-1.json' with { type: 'json' };
import vr from '../../supabase/functions/_shared/fixtures/vr-1.json' with { type: 'json' };

const report = checkFixtures([mobile, vr]);
for (const line of report.lines) console.log(line);
for (const err of report.hashErrors) console.log(`FAIL ruleset ${err}`);
console.log(`Deno ${Deno.version.deno} (V8 ${Deno.version.v8}): ${report.passed}/${report.total} runs passed`);
console.log(`RESULT ${JSON.stringify({ runtime: 'deno', passed: report.passed, total: report.total, ok: report.ok })}`);
Deno.exit(report.ok ? 0 : 1);
