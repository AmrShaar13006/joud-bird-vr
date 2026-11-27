// Where a run's seed comes from. Step 1: the client makes it with crypto. Step 2 will ask
// the server for ranked runs; this file is the one place to change.

import type { Mode } from '../core/config';
import { MOBILE1 } from '../core/ruleset';
import type { RunLog, RunResult, RunSpec } from '../core/run';
import { randomSeed } from '../scene/seed';

export const RULESET = MOBILE1;

export interface MobileRunSpec extends RunSpec {
  /** Practice runs are never submitted. */
  practice: boolean;
}

export function getRunSpec(mode: Mode, practice = false): MobileRunSpec {
  return { rulesetId: RULESET.id, mode, seed: randomSeed(), practice };
}

export interface RunRecord {
  spec: MobileRunSpec;
  log: RunLog;
  result: RunResult;
}

/** With ?debug=1: the last 5 ranked runs, also on window.__joudRuns. */
export const recentRuns: RunRecord[] = [];

export function recordRun(spec: MobileRunSpec, log: RunLog, result: RunResult, debug: boolean): void {
  if (spec.practice || !debug) return;
  recentRuns.push({ spec, log, result });
  if (recentRuns.length > 5) recentRuns.shift();
  (window as unknown as { __joudRuns?: RunRecord[] }).__joudRuns = recentRuns;
  console.log('[joud] ranked run', JSON.stringify(log), result);
}
