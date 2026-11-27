// Shapes shared by the Edge Functions and their tests. No imports: tests run without npm.

export type Mode = 'easy' | 'normal' | 'hard';

/** The ruleset every ranked phone run uses (a new id means new fixtures; see CLAUDE.md). */
export const RANKED_RULESET = 'mobile-1';
/** Longest possible run (54,000 ticks at 60 Hz) + time for an offline retry. */
export const TICKET_TTL_S = 15 * 60 + 15 * 60;
/** A run may arrive at most this much sooner than it could have been played (clock jitter). */
export const WALL_CLOCK_SLACK_MS = 5000;
/** Request body cap. A 15-minute run at 3 taps a second is about 2,700 flaps (~20 kB). */
export const MAX_BODY_BYTES = 256 * 1024;
export const MAX_FLAPS = 20000;

export interface Ticket {
  id: string;
  user_id: string;
  ruleset_id: string;
  mode: string;
  seed: number;
  issued_at: string;
  expires_at: string;
  used_at: string | null;
}

export interface StoredRun {
  id: number;
  user_id: string;
  flaps: number[];
  end_tick: number;
  valid: boolean;
  reason: string | null;
  score: number;
  obstacle_points: number;
  flowers: number;
  impact: number;
  end_reason: string | null;
}

export type IssueResult =
  | { ok: true; ticketId: string; rulesetId: string; mode: string; seed: number; issuedAt: string; expiresAt: string }
  | { ok: false; reason: 'tooManyOpen' | 'tooManyPerHour' };

export interface RunRow {
  ticketId: string | null;
  userId: string;
  rulesetId: string;
  mode: string;
  seed: number;
  flaps: number[];
  endTick: number;
  valid: boolean;
  reason: string | null;
  score: number;
  obstaclePoints: number;
  flowers: number;
  impact: number;
  endReason: string | null;
  hash: string | null;
  clientScore: number | null;
}

/** Everything the handlers need from the database (Supabase in production, a fake in tests). */
export interface Db {
  issueTicket(userId: string, rulesetId: string, mode: Mode, seed: number, ttlSeconds: number): Promise<IssueResult>;
  getTicket(id: string): Promise<Ticket | null>;
  findRunByTicket(ticketId: string): Promise<StoredRun | null>;
  /** Consumes the ticket (if any) and stores the run in one transaction. */
  recordRun(row: RunRow): Promise<{ runId: number; valid: boolean; reason: string | null }>;
}

/** What a handler answers: an HTTP status and a JSON body. */
export interface Reply {
  status: number;
  body: Record<string, unknown>;
}

export function isMode(v: unknown): v is Mode {
  return v === 'easy' || v === 'normal' || v === 'hard';
}
