// submit-run: verify a ranked run by replaying it with the committed sim bundle, then store
// the server's own result. The phone sends only (ticketId, flaps, endTick, clientScore);
// ruleset, mode and seed come from the ticket, and score, flowers, impact and end reason come
// from the replay. Every rejection is stored with a reason code; nothing here throws on bad
// input. Pure over `Db` and a clock, so Deno tests call it with a fake.

// @ts-ignore: plain JS bundle generated from src/core (npm run build:sim).
import { getRuleset, replay, validateLog } from './joud-sim.js';
import { type Db, MAX_FLAPS, type Reply, type RunRow, type StoredRun, WALL_CLOCK_SLACK_MS } from './types.ts';

/** What replay() returns (src/core/run.ts RunResult). */
interface Replayed {
  valid: boolean;
  reason?: string;
  score: number;
  obstaclePoints: number;
  flowers: number;
  impact: number;
  endTick: number;
  endReason: string;
  hash: string;
}

interface SubmitBody {
  ticketId: string;
  flaps: unknown;
  endTick: unknown;
  clientScore: number | null;
}

function parse(body: unknown): SubmitBody | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.ticketId !== 'string' || b.ticketId.length > 64) return null;
  if (Array.isArray(b.flaps) && b.flaps.length > MAX_FLAPS) return null;
  const cs = b.clientScore;
  return {
    ticketId: b.ticketId,
    flaps: b.flaps,
    endTick: b.endTick,
    clientScore: typeof cs === 'number' && Number.isInteger(cs) ? cs : null,
  };
}

/** Flaps as stored: integers only (anything else is rejected by validateLog anyway). */
function storableFlaps(flaps: unknown): number[] {
  if (!Array.isArray(flaps)) return [];
  return flaps.filter((t): t is number => typeof t === 'number' && Number.isInteger(t)).slice(0, MAX_FLAPS);
}

function storableTick(t: unknown): number {
  return typeof t === 'number' && Number.isInteger(t) && t >= 0 && t <= 2_000_000_000 ? t : -1;
}

function sameRun(a: StoredRun, flaps: unknown, endTick: unknown): boolean {
  if (a.end_tick !== endTick || !Array.isArray(flaps) || a.flaps.length !== flaps.length) return false;
  for (let i = 0; i < flaps.length; i++) if (a.flaps[i] !== flaps[i]) return false;
  return true;
}

function resultReply(run: StoredRun | { valid: boolean; reason: string | null; runId: number }, extra: Record<string, unknown> = {}): Reply {
  return { status: 200, body: { ...run, ...extra } };
}

export async function submitRun(db: Db, userId: string, rawBody: unknown, nowMs: number = Date.now()): Promise<Reply> {
  const body = parse(rawBody);
  if (!body) return { status: 400, body: { error: 'badRequest' } };

  const base: RunRow = {
    ticketId: null,
    userId,
    rulesetId: 'none',
    mode: 'none',
    seed: 0,
    flaps: storableFlaps(body.flaps),
    endTick: storableTick(body.endTick),
    valid: false,
    reason: null,
    score: 0,
    obstaclePoints: 0,
    flowers: 0,
    impact: 0,
    endReason: null,
    hash: null,
    clientScore: body.clientScore,
  };
  const reject = async (reason: string, row: RunRow = base): Promise<Reply> => {
    const r = await db.recordRun({ ...row, valid: false, reason });
    return resultReply({ runId: r.runId, valid: false, reason: r.reason ?? reason });
  };

  // 1. Ticket: exists, belongs to this player, unused, not expired.
  const ticket = await db.getTicket(body.ticketId);
  if (!ticket || ticket.user_id !== userId) return reject('badTicket');
  const fromTicket: RunRow = { ...base, rulesetId: ticket.ruleset_id, mode: ticket.mode, seed: Number(ticket.seed) };
  if (ticket.used_at) {
    // A retry of a run we already stored (the reply got lost): answer it again, store nothing.
    const prior = await db.findRunByTicket(ticket.id);
    if (prior && prior.user_id === userId && sameRun(prior, body.flaps, body.endTick)) {
      return resultReply(
        {
          runId: prior.id,
          valid: prior.valid,
          reason: prior.reason,
        },
        {
          score: prior.score,
          obstaclePoints: prior.obstacle_points,
          flowers: prior.flowers,
          impact: prior.impact,
          endTick: prior.end_tick,
          endReason: prior.end_reason,
          duplicate: true,
        },
      );
    }
    return reject('ticketUsed', fromTicket);
  }
  const withTicket: RunRow = { ...fromTicket, ticketId: ticket.id };
  if (Date.parse(ticket.expires_at) < nowMs) return reject('ticketExpired', withTicket);

  // 2. Log: the ticket's ruleset, mode and seed plus the phone's flaps and end tick.
  const log = {
    rulesetId: ticket.ruleset_id,
    mode: ticket.mode,
    seed: Number(ticket.seed),
    flaps: body.flaps,
    endTick: body.endTick,
  };
  const why = validateLog(log);
  if (why) return reject(why, withTicket);

  // 3. Replay: must end exactly at the claimed tick, by hitting something or running out.
  const result = replay(log) as Replayed;
  if (!result.valid) return reject(result.reason ?? 'internal', withTicket);
  if (result.endReason === 'logEnd' || result.endTick !== log.endTick) {
    return reject('endMismatch', { ...withTicket, endReason: result.endReason, hash: result.hash });
  }

  // 4. Wall clock: a run can't arrive sooner than it takes to play.
  const rs = getRuleset(ticket.ruleset_id) as { step: number };
  const playMs = log.endTick * rs.step * 1000;
  if (nowMs - Date.parse(ticket.issued_at) < playMs - WALL_CLOCK_SLACK_MS) {
    return reject('tooFast', { ...withTicket, endReason: result.endReason, hash: result.hash });
  }

  // 5. Store the server's own result.
  const stored = await db.recordRun({
    ...withTicket,
    valid: true,
    reason: null,
    score: result.score,
    obstaclePoints: result.obstaclePoints,
    flowers: result.flowers,
    impact: result.impact,
    endReason: result.endReason,
    hash: result.hash,
  });
  const scoreMismatch = body.clientScore !== null && body.clientScore !== result.score;
  return resultReply(
    { runId: stored.runId, valid: stored.valid, reason: stored.reason },
    stored.valid
      ? {
          score: result.score,
          obstaclePoints: result.obstaclePoints,
          flowers: result.flowers,
          impact: result.impact,
          endTick: result.endTick,
          endReason: result.endReason,
          ...(scoreMismatch ? { scoreMismatch: true } : {}),
        }
      : {},
  );
}
