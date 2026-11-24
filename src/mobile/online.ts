// Ranked play's network side, without the network: a ticket pool (one server seed kept ready
// per mode, so «العب» never waits) and an outbox (finished runs, kept in localStorage until
// the server has answered or the ticket expired). The transport is injected, so this file is
// unit-tested in Node; src/mobile/net.ts is the Supabase implementation.

import type { Mode } from '../core/config';

export interface ServerTicket {
  ticketId: string;
  rulesetId: string;
  mode: Mode;
  seed: number;
  issuedAt: string;
  expiresAt: string;
}

export interface PendingRun {
  ticketId: string;
  mode: Mode;
  flaps: number[];
  endTick: number;
  clientScore: number;
  expiresAt: string;
}

/** The server's verdict on a run (submit-run). */
export interface Verdict {
  valid: boolean;
  reason?: string | null;
  score?: number;
  flowers?: number;
  impact?: number;
  duplicate?: boolean;
}

/** Thrown by a transport when it is worth trying again later (offline, 5xx, signed out). */
export class RetryLater extends Error {}

export interface Transport {
  issue(mode: Mode): Promise<ServerTicket>;
  /** A verdict, or throws RetryLater. Any other answer (4xx) is a final verdict. */
  submit(run: PendingRun): Promise<Verdict>;
}

export interface KeyValue {
  get(): string | null;
  set(value: string): void;
}

/** A ticket is handed out only if a full-length round still fits before it expires. */
export const TICKET_MIN_LEFT_MS = 16 * 60 * 1000;
export const OUTBOX_MAX = 5;

export class Tickets {
  private readonly ready = new Map<Mode, ServerTicket>();
  private readonly pending = new Set<Mode>();

  constructor(
    private readonly transport: Transport,
    private readonly rulesetId: string,
    private readonly now: () => number = Date.now,
  ) {}

  private usable(t: ServerTicket | undefined): t is ServerTicket {
    return !!t && t.rulesetId === this.rulesetId && Date.parse(t.expiresAt) - this.now() > TICKET_MIN_LEFT_MS;
  }

  /** Fetch a ticket for `mode` in the background unless one is ready or on its way. */
  prefetch(mode: Mode): Promise<void> {
    if (this.usable(this.ready.get(mode)) || this.pending.has(mode)) return Promise.resolve();
    this.pending.add(mode);
    return this.transport
      .issue(mode)
      .then((t) => {
        if (t.mode === mode) this.ready.set(mode, t);
      })
      .catch(() => {
        // offline or rate-limited: the next round is practice; we try again later
      })
      .finally(() => this.pending.delete(mode));
  }

  /** The ready ticket for `mode` (removed from the pool), or null: play practice instead. */
  take(mode: Mode): ServerTicket | null {
    const t = this.ready.get(mode);
    this.ready.delete(mode);
    return this.usable(t) ? t : null;
  }

  has(mode: Mode): boolean {
    return this.usable(this.ready.get(mode));
  }
}

export class Outbox {
  private flushing: Promise<void> | null = null;

  constructor(
    private readonly transport: Transport,
    private readonly store: KeyValue,
    private readonly now: () => number = Date.now,
  ) {}

  private load(): PendingRun[] {
    try {
      const list = JSON.parse(this.store.get() ?? '[]');
      return Array.isArray(list) ? list.filter((r) => r && typeof r.ticketId === 'string') : [];
    } catch {
      return [];
    }
  }

  private save(list: PendingRun[]): void {
    try {
      this.store.set(JSON.stringify(list));
    } catch {
      // storage blocked: the run is only tried while the page is open
    }
  }

  private alive(r: PendingRun): boolean {
    return Date.parse(r.expiresAt) > this.now();
  }

  get size(): number {
    return this.load().filter((r) => this.alive(r)).length;
  }

  /** Queue a finished run and send it now. Resolves with the verdict, or 'queued' when offline. */
  async add(run: PendingRun): Promise<Verdict | 'queued'> {
    const list = this.load().filter((r) => this.alive(r) && r.ticketId !== run.ticketId);
    list.push(run);
    this.save(list.slice(-OUTBOX_MAX));
    return this.send(run);
  }

  private async send(run: PendingRun): Promise<Verdict | 'queued'> {
    try {
      const verdict = await this.transport.submit(run);
      this.save(this.load().filter((r) => r.ticketId !== run.ticketId));
      return verdict;
    } catch (e) {
      if (e instanceof RetryLater) return 'queued';
      // Unexpected: keep it for a later try rather than lose a run.
      return 'queued';
    }
  }

  /** Retry every queued run that can still be accepted; drop the expired ones. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      const list = this.load();
      this.save(list.filter((r) => this.alive(r)));
      for (const run of list) if (this.alive(run)) await this.send(run);
    })().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }
}
