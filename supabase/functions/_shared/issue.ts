// issue-run: a single-use ticket carrying a server-drawn seed for one ranked round.
// Pure over `Db`, so Deno tests call it with a fake. No game logic here.

import { type Db, isMode, RANKED_RULESET, type Reply, TICKET_TTL_S } from './types.ts';

/** A uint32 from the platform's CSPRNG. */
export function serverSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

export async function issueRun(db: Db, userId: string, body: unknown, seed: () => number = serverSeed): Promise<Reply> {
  const mode = (body as { mode?: unknown } | null)?.mode;
  if (!isMode(mode)) return { status: 400, body: { error: 'badMode' } };
  const r = await db.issueTicket(userId, RANKED_RULESET, mode, seed(), TICKET_TTL_S);
  // No complete student profile (a guest, an old anonymous session, an unfinished sign-up): 403.
  if (!r.ok) return { status: r.reason === 'needsProfile' ? 403 : 429, body: { error: r.reason } };
  return {
    status: 200,
    body: {
      ticketId: r.ticketId,
      rulesetId: r.rulesetId,
      mode: r.mode,
      seed: r.seed,
      issuedAt: r.issuedAt,
      expiresAt: r.expiresAt,
    },
  };
}
