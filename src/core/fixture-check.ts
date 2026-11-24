// Checks recorded runs against their expected results. The same function runs in
// Vitest (Node), the check/ page (Chrome, Safari) and Deno (the sim bundle).

import { replay } from './replay';
import { getRuleset, rulesetHash } from './ruleset';
import type { RunLog, RunResult } from './run';

export interface FixtureRun {
  name: string;
  log: RunLog;
  expected: RunResult;
}

export interface FixtureFile {
  rulesetId: string;
  rulesetHash: string;
  runs: FixtureRun[];
}

export interface CheckReport {
  total: number;
  passed: number;
  /** Ruleset hashes that do not match the fixture files. */
  hashErrors: string[];
  /** One line per run: "PASS mobile-1/normal-bot-1" or "FAIL … (field: expected ≠ got)". */
  lines: string[];
  ok: boolean;
}

const FIELDS: (keyof RunResult)[] = [
  'valid',
  'reason',
  'score',
  'obstaclePoints',
  'flowers',
  'impact',
  'endTick',
  'endReason',
  'hash',
];

/** First differing field, or null when the results match. */
export function diffResults(expected: RunResult, got: RunResult): string | null {
  for (const f of FIELDS) {
    if (expected[f] !== got[f]) return `${f}: ${String(expected[f])} ≠ ${String(got[f])}`;
  }
  const a = expected.checkpoints;
  const b = got.checkpoints;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return `checkpoint ${i}: ${a[i]} ≠ ${b[i]}`;
  }
  return null;
}

export function checkFixtures(files: readonly FixtureFile[]): CheckReport {
  const lines: string[] = [];
  const hashErrors: string[] = [];
  let total = 0;
  let passed = 0;
  for (const file of files) {
    const rs = getRuleset(file.rulesetId);
    const hash = rs ? rulesetHash(rs) : 'missing';
    if (hash !== file.rulesetHash) {
      hashErrors.push(`${file.rulesetId}: constants hash ${hash} ≠ fixtures ${file.rulesetHash}`);
    }
    for (const run of file.runs) {
      total++;
      const diff = diffResults(run.expected, replay(run.log));
      if (diff === null) {
        passed++;
        lines.push(`PASS ${file.rulesetId}/${run.name}`);
      } else {
        lines.push(`FAIL ${file.rulesetId}/${run.name} (${diff})`);
      }
    }
  }
  return { total, passed, hashErrors, lines, ok: passed === total && hashErrors.length === 0 };
}
