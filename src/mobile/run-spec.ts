// Where a run's seed comes from: the one place that decides it.
// Ranked rounds use a server ticket (step 2, src/mobile/online.ts); practice uses crypto.
// Without a ticket (offline, signed out, rate-limited) a ranked request becomes practice:
// never a ranked round on a client-made seed.

import type { Mode } from '../core/config';
import { MOBILE1 } from '../core/ruleset';
import type { RunLog, RunResult, RunSpec } from '../core/run';
import { randomSeed } from '../scene/seed';
import type { ServerTicket } from './online';

export const RULESET = MOBILE1;

export interface MobileRunSpec extends RunSpec {
  /** Practice runs are never submitted. */
  practice: boolean;
  /** Ranked: the server ticket this round's seed came from. */
  ticketId?: string;
  ticketExpiresAt?: string;
  /** Asked for ranked but had no ticket, so it is practice (shown as «بدون اتصال»). */
  offline?: boolean;
}

export function getRunSpec(mode: Mode, practice = false, ticket: ServerTicket | null = null): MobileRunSpec {
  if (!practice && ticket && ticket.rulesetId === RULESET.id && ticket.mode === mode) {
    return {
      rulesetId: RULESET.id,
      mode,
      seed: ticket.seed >>> 0,
      practice: false,
      ticketId: ticket.ticketId,
      ticketExpiresAt: ticket.expiresAt,
    };
  }
  return { rulesetId: RULESET.id, mode, seed: randomSeed(), practice: true, offline: !practice };
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
