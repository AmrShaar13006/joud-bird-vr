// Deno tests for issue-run and submit-run against a fake database:
//   deno test --allow-read=. supabase/functions
// The happy path replays every valid committed mobile-1 fixture through submit-run.
// Built-in node:assert: no test dependency to download.
import { deepStrictEqual as assertEquals, ok as assert } from 'node:assert/strict';
import { issueRun } from './issue.ts';
import { submitRun } from './submit.ts';
import { type Db, type IssueResult, type RunRow, type StoredRun, type Ticket, TICKET_TTL_S } from './types.ts';

const fixtures = JSON.parse(await Deno.readTextFile(new URL('./fixtures/mobile-1.json', import.meta.url)));
const ME = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const T0 = Date.parse('2026-11-25T12:00:00Z');

/** In-memory Db with the same rules as the SQL functions (limits, single-use tickets). */
class FakeDb implements Db {
  tickets = new Map<string, Ticket>();
  runs: (RunRow & { id: number; ticketUsedAt?: string })[] = [];
  private n = 0;
  constructor(private now = T0) {}

  addTicket(t: Partial<Ticket> & { seed: number; mode: string }, issuedMsAgo = 0): Ticket {
    const id = `00000000-0000-0000-0000-${String(++this.n).padStart(12, '0')}`;
    const ticket: Ticket = {
      id,
      user_id: ME,
      ruleset_id: 'mobile-1',
      issued_at: new Date(this.now - issuedMsAgo).toISOString(),
      expires_at: new Date(this.now - issuedMsAgo + TICKET_TTL_S * 1000).toISOString(),
      used_at: null,
      ...t,
    };
    this.tickets.set(id, ticket);
    return ticket;
  }

  /** Players without a complete student profile and a name (public.issue_ticket: needsProfile). */
  noProfile = new Set<string>();

  issueTicket(userId: string, rulesetId: string, mode: string, seed: number, ttl: number): Promise<IssueResult> {
    if (this.noProfile.has(userId)) return Promise.resolve({ ok: false, reason: 'needsProfile' });
    const mine = [...this.tickets.values()].filter((t) => t.user_id === userId);
    const open = mine.filter((t) => !t.used_at && Date.parse(t.expires_at) > this.now).length;
    if (open >= 3) return Promise.resolve({ ok: false, reason: 'tooManyOpen' });
    const hour = mine.filter((t) => Date.parse(t.issued_at) > this.now - 3600_000).length;
    if (hour >= 120) return Promise.resolve({ ok: false, reason: 'tooManyPerHour' });
    const t = this.addTicket({ user_id: userId, ruleset_id: rulesetId, mode, seed });
    t.expires_at = new Date(this.now + ttl * 1000).toISOString();
    return Promise.resolve({ ok: true, ticketId: t.id, rulesetId, mode, seed, issuedAt: t.issued_at, expiresAt: t.expires_at });
  }
  getTicket(id: string) {
    return Promise.resolve(this.tickets.get(id) ?? null);
  }
  findRunByTicket(ticketId: string): Promise<StoredRun | null> {
    const r = this.runs.find((x) => x.ticketId === ticketId);
    return Promise.resolve(
      r
        ? {
            id: r.id, user_id: r.userId, flaps: r.flaps, end_tick: r.endTick, valid: r.valid, reason: r.reason,
            score: r.score, obstacle_points: r.obstaclePoints, flowers: r.flowers, impact: r.impact, end_reason: r.endReason,
          }
        : null,
    );
  }
  recordRun(row: RunRow) {
    let { ticketId, valid, reason } = row;
    if (ticketId) {
      const t = this.tickets.get(ticketId);
      if (!t || t.used_at || t.user_id !== row.userId) {
        ticketId = null;
        valid = false;
        reason = 'ticketUsed';
      } else t.used_at = new Date(this.now).toISOString();
    }
    const id = this.runs.length + 1;
    this.runs.push({ ...row, ticketId, valid, reason, id });
    return Promise.resolve({ runId: id, valid, reason });
  }
}

const playable = fixtures.runs.filter(
  (r: { expected: { valid: boolean; endReason: string } }) => r.expected.valid && r.expected.endReason !== 'logEnd',
);
const playMs = (endTick: number) => (endTick / 60) * 1000;

Deno.test('issue-run: a ticket for the ranked ruleset with a server seed; bad mode refused', async () => {
  const db = new FakeDb();
  const r = await issueRun(db, ME, { mode: 'hard' }, () => 123456);
  assertEquals(r.status, 200);
  assertEquals(r.body.rulesetId, 'mobile-1');
  assertEquals(r.body.mode, 'hard');
  assertEquals(r.body.seed, 123456);
  assertEquals((await issueRun(db, ME, { mode: 'ultra' })).status, 400);
  assertEquals((await issueRun(db, ME, null)).status, 400);
});

Deno.test('issue-run: no complete profile (guest, old anonymous session) is 403 needsProfile', async () => {
  const db = new FakeDb();
  db.noProfile.add(OTHER);
  const r = await issueRun(db, OTHER, { mode: 'normal' });
  assertEquals(r.status, 403);
  assertEquals(r.body.error, 'needsProfile');
  assertEquals(db.tickets.size, 0);
  assertEquals((await issueRun(db, ME, { mode: 'normal' })).status, 200);
});

Deno.test('issue-run: the 4th open ticket and the 121st in an hour are refused', async () => {
  const db = new FakeDb();
  for (let i = 0; i < 3; i++) assertEquals((await issueRun(db, ME, { mode: 'easy' })).status, 200);
  const fourth = await issueRun(db, ME, { mode: 'easy' });
  assertEquals(fourth.status, 429);
  assertEquals(fourth.body.error, 'tooManyOpen');
  // Another player is not affected.
  assertEquals((await issueRun(db, OTHER, { mode: 'easy' })).status, 200);

  const busy = new FakeDb();
  for (let i = 0; i < 120; i++) {
    busy.addTicket({ seed: i, mode: 'easy', used_at: new Date(T0).toISOString() }, 60_000);
  }
  const over = await issueRun(busy, ME, { mode: 'easy' });
  assertEquals(over.status, 429);
  assertEquals(over.body.error, 'tooManyPerHour');
});

Deno.test(`submit-run: every playable mobile-1 fixture (${playable.length}) verifies to its stored result`, async () => {
  for (const run of playable) {
    const db = new FakeDb();
    const t = db.addTicket({ seed: run.log.seed, mode: run.log.mode }, playMs(run.log.endTick) + 1000);
    const r = await submitRun(db, ME, { ticketId: t.id, flaps: run.log.flaps, endTick: run.log.endTick, clientScore: run.expected.score }, T0);
    assertEquals(r.status, 200, run.name);
    assertEquals(r.body.valid, true, `${run.name}: ${r.body.reason}`);
    assertEquals(r.body.score, run.expected.score, run.name);
    assertEquals(r.body.impact, run.expected.impact, run.name);
    assertEquals(r.body.endReason, run.expected.endReason, run.name);
    assertEquals(r.body.scoreMismatch, undefined, run.name);
    assert(db.tickets.get(t.id)!.used_at, `${run.name}: ticket consumed`);
  }
});

const sample = playable.find((r: { name: string }) => r.name === 'normal-bot-long');

async function submitSample(db: FakeDb, ticket: Ticket, over: Record<string, unknown> = {}) {
  return submitRun(db, ME, { ticketId: ticket.id, flaps: sample.log.flaps, endTick: sample.log.endTick, clientScore: 999, ...over }, T0);
}

Deno.test('submit-run: the ticket wins; the client score is only compared', async () => {
  const db = new FakeDb();
  const t = db.addTicket({ seed: sample.log.seed, mode: sample.log.mode }, 120_000);
  const r = await submitSample(db, t, { seed: 42, mode: 'easy', rulesetId: 'vr-1', score: 9999 });
  assertEquals(r.body.valid, true);
  assertEquals(r.body.score, sample.expected.score);
  assertEquals(r.body.scoreMismatch, true);
  assertEquals(db.runs[0].seed, sample.log.seed);
  assertEquals(db.runs[0].mode, sample.log.mode);
});

Deno.test('submit-run: unknown or someone else\'s ticket is badTicket', async () => {
  const db = new FakeDb();
  assertEquals((await submitRun(db, ME, { ticketId: 'nope', flaps: [0], endTick: 5 }, T0)).body.reason, 'badTicket');
  const theirs = db.addTicket({ seed: sample.log.seed, mode: sample.log.mode, user_id: OTHER }, 120_000);
  const r = await submitSample(db, theirs);
  assertEquals(r.body.valid, false);
  assertEquals(r.body.reason, 'badTicket');
  assertEquals(db.tickets.get(theirs.id)!.used_at, null, 'their ticket stays usable');
  assertEquals(db.runs.length, 2, 'both rejections are stored');
});

Deno.test('submit-run: a used ticket is refused, but an identical retry gets the stored answer', async () => {
  const db = new FakeDb();
  const t = db.addTicket({ seed: sample.log.seed, mode: sample.log.mode }, 120_000);
  const first = await submitSample(db, t);
  assertEquals(first.body.valid, true);
  const retry = await submitSample(db, t);
  assertEquals(retry.body.duplicate, true);
  assertEquals(retry.body.score, first.body.score);
  assertEquals(retry.body.runId, first.body.runId);
  assertEquals(db.runs.length, 1, 'a retry stores nothing');
  const other = await submitSample(db, t, { flaps: [0, 50], endTick: 200 });
  assertEquals(other.body.valid, false);
  assertEquals(other.body.reason, 'ticketUsed');
});

Deno.test('submit-run: an expired ticket is refused', async () => {
  const db = new FakeDb();
  const t = db.addTicket({ seed: sample.log.seed, mode: sample.log.mode }, TICKET_TTL_S * 1000 + 1000);
  assertEquals((await submitSample(db, t)).body.reason, 'ticketExpired');
});

Deno.test('submit-run: every bad log the phone could send is refused with its reason', async () => {
  const cases: [string, unknown, unknown][] = [
    ['noFlaps', [], 100],
    ['badFlap', [0, 1.5], 100],
    ['duplicateFlap', [0, 5, 5], 100],
    ['unsortedFlaps', [0, 9, 4], 100],
    ['firstFlapNotZero', [3, 9], 100],
    ['flapAfterEnd', [0, 120], 100],
    ['badEndTick', [0], 0],
    ['endTickTooLarge', [0], 54001],
  ];
  for (const [reason, flaps, endTick] of cases) {
    const db = new FakeDb();
    const t = db.addTicket({ seed: 7, mode: 'normal' }, 1_000_000);
    const r = await submitRun(db, ME, { ticketId: t.id, flaps, endTick }, T0);
    assertEquals(r.body.valid, false, reason);
    assertEquals(r.body.reason, reason);
    assert(db.tickets.get(t.id)!.used_at, `${reason}: the ticket is burned`);
  }
});

Deno.test('submit-run: a run must end exactly where the phone says (endMismatch)', async () => {
  for (const endTick of [sample.log.endTick - 30, sample.log.endTick + 30]) {
    const db = new FakeDb();
    const t = db.addTicket({ seed: sample.log.seed, mode: sample.log.mode }, 120_000);
    const flaps = sample.log.flaps.filter((f: number) => f < endTick);
    const r = await submitSample(db, t, { flaps, endTick });
    assertEquals(r.body.valid, false, String(endTick));
    assertEquals(r.body.reason, 'endMismatch');
  }
});

Deno.test('submit-run: a run that arrives faster than it can be played is tooFast', async () => {
  const db = new FakeDb();
  // normal-bot-long lasts 2115 ticks = 35.25 s; the ticket was issued 10 s ago.
  const t = db.addTicket({ seed: sample.log.seed, mode: sample.log.mode }, 10_000);
  assertEquals((await submitSample(db, t)).body.reason, 'tooFast');
});

Deno.test('submit-run: malformed bodies are 400 and store nothing', async () => {
  const db = new FakeDb();
  for (const body of [null, 'x', { flaps: [0] }, { ticketId: 5 }, { ticketId: 'a', flaps: new Array(20001).fill(0) }]) {
    assertEquals((await submitRun(db, ME, body, T0)).status, 400);
  }
  assertEquals(db.runs.length, 0);
});
