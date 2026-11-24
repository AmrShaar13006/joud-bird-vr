import { describe, expect, it } from 'vitest';
import type { Mode } from '../core/config';
import { type KeyValue, Outbox, type PendingRun, RetryLater, type ServerTicket, Tickets, type Transport, type Verdict } from './online';

const T0 = Date.parse('2026-11-25T12:00:00Z');
const ticket = (mode: Mode, n: number, minutesLeft = 30, rulesetId = 'mobile-1'): ServerTicket => ({
  ticketId: `t${n}`,
  rulesetId,
  mode,
  seed: 1000 + n,
  issuedAt: new Date(T0).toISOString(),
  expiresAt: new Date(T0 + minutesLeft * 60_000).toISOString(),
});
const run = (id: string, minutesLeft = 30): PendingRun => ({
  ticketId: id,
  mode: 'normal',
  flaps: [0, 40],
  endTick: 200,
  clientScore: 3,
  expiresAt: new Date(T0 + minutesLeft * 60_000).toISOString(),
});

class FakeTransport implements Transport {
  issued = 0;
  online = true;
  submitted: string[] = [];
  next: ServerTicket | null = null;
  issue(mode: Mode) {
    if (!this.online) return Promise.reject(new RetryLater('offline'));
    this.issued++;
    return Promise.resolve(this.next ?? ticket(mode, this.issued));
  }
  submit(r: PendingRun): Promise<Verdict> {
    if (!this.online) return Promise.reject(new RetryLater('offline'));
    this.submitted.push(r.ticketId);
    return Promise.resolve({ valid: true, score: r.clientScore });
  }
}

const memory = (): KeyValue & { value: string | null } => {
  const kv = {
    value: null as string | null,
    get: () => kv.value,
    set: (v: string) => {
      kv.value = v;
    },
  };
  return kv;
};

describe('ticket pool', () => {
  it('keeps one ticket ready per mode and hands it out once', async () => {
    const t = new FakeTransport();
    const pool = new Tickets(t, 'mobile-1', () => T0);
    await pool.prefetch('normal');
    await pool.prefetch('normal'); // already ready: no second request
    expect(t.issued).toBe(1);
    expect(pool.take('easy')).toBeNull();
    expect(pool.take('normal')?.seed).toBe(1001);
    expect(pool.take('normal')).toBeNull(); // single use
  });

  it('offline: no ticket, so the round is practice; it fetches again later', async () => {
    const t = new FakeTransport();
    t.online = false;
    const pool = new Tickets(t, 'mobile-1', () => T0);
    await pool.prefetch('hard');
    expect(pool.take('hard')).toBeNull();
    t.online = true;
    await pool.prefetch('hard');
    expect(pool.take('hard')).not.toBeNull();
  });

  it('refuses a ticket a full round would outlive, or one for another ruleset', async () => {
    const t = new FakeTransport();
    let now = T0;
    const pool = new Tickets(t, 'mobile-1', () => now);
    await pool.prefetch('normal');
    now = T0 + 15 * 60_000; // 15 of 30 minutes gone: less than a full round left
    expect(pool.take('normal')).toBeNull();
    t.next = ticket('normal', 9, 30, 'mobile-2');
    now = T0;
    await pool.prefetch('normal');
    expect(pool.take('normal')).toBeNull();
  });
});

describe('outbox', () => {
  it('sends a run at once and forgets it after a verdict', async () => {
    const t = new FakeTransport();
    const kv = memory();
    const box = new Outbox(t, kv, () => T0);
    expect(await box.add(run('a'))).toEqual({ valid: true, score: 3 });
    expect(box.size).toBe(0);
  });

  it('offline: queues, survives a reload, and sends on flush once back online', async () => {
    const t = new FakeTransport();
    const kv = memory();
    t.online = false;
    expect(await new Outbox(t, kv, () => T0).add(run('a'))).toBe('queued');
    const reloaded = new Outbox(t, kv, () => T0); // same storage, new page
    expect(reloaded.size).toBe(1);
    t.online = true;
    await reloaded.flush();
    expect(t.submitted).toEqual(['a']);
    expect(reloaded.size).toBe(0);
  });

  it('keeps at most 5 runs and drops expired ones', async () => {
    const t = new FakeTransport();
    t.online = false;
    const kv = memory();
    let now = T0;
    const box = new Outbox(t, kv, () => now);
    for (let i = 0; i < 7; i++) await box.add(run(`r${i}`, 10 + i));
    expect(box.size).toBe(5);
    now = T0 + 13.5 * 60_000; // r2 and r3 have expired by now
    expect(box.size).toBe(3);
    t.online = true;
    await box.flush();
    expect(t.submitted).toEqual(['r4', 'r5', 'r6']);
  });
});
