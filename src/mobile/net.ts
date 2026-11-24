// The phone's only connection to the server (Supabase). Loaded lazily by main.ts the first
// time ranked play is possible, so practice and first paint never wait for it.
// Anonymous sign-in, no personal data: a nickname from a fixed list (docs/server.md).

import { createClient, FunctionsFetchError, FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import type { Mode } from '../core/config';
import { type PendingRun, RetryLater, type ServerTicket, type Transport, type Verdict } from './online';

export interface BoardRow {
  rank: number;
  nickname: string;
  score: number;
}

export interface Profile {
  nicknameId: number;
  tag: number;
}

export interface Net extends Transport {
  /** Signs in anonymously if needed. False when offline or refused. */
  signIn(): Promise<boolean>;
  profile(): Promise<Profile | null>;
  setNickname(nicknameId: number): Promise<boolean>;
  leaderboard(mode: Mode, rulesetId: string): Promise<BoardRow[]>;
  myBest(mode: Mode, rulesetId: string): Promise<{ rank: number; score: number } | null>;
  impactTotal(): Promise<number | null>;
}

export function createNet(url: string, key: string): Net {
  const sb: SupabaseClient = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'joudbird.auth' },
  });
  let userId: string | null = null;
  let signing: Promise<boolean> | null = null;

  /**
   * Single-flight: the warm-up and the first ticket request run at the same time on page
   * load. Two parallel signInAnonymously() calls would make two users, and a ticket issued
   * to one would then be submitted by the other (badTicket). Everyone shares one sign-in.
   */
  function signIn(): Promise<boolean> {
    signing ??= doSignIn().then((ok) => {
      if (!ok) signing = null; // offline or refused: try again next time
      return ok;
    });
    return signing;
  }

  async function doSignIn(): Promise<boolean> {
    try {
      const { data } = await sb.auth.getSession();
      if (data.session) {
        userId = data.session.user.id;
        return true;
      }
      const { data: d, error } = await sb.auth.signInAnonymously();
      if (error || !d.user) return false;
      userId = d.user.id;
      return true;
    } catch {
      return false;
    }
  }

  /** Calls an Edge Function. Network, 5xx and 401 are "try later"; other answers are final. */
  async function call<T>(name: string, body: unknown): Promise<T> {
    if (!userId && !(await signIn())) throw new RetryLater('signIn');
    const { data, error } = await sb.functions.invoke(name, { body: body as Record<string, unknown> });
    if (!error) return data as T;
    if (error instanceof FunctionsFetchError) throw new RetryLater('offline');
    if (error instanceof FunctionsHttpError) {
      const res = error.context as Response;
      if (res.status >= 500 || res.status === 401 || res.status === 429) throw new RetryLater(`http ${res.status}`);
      const reply = await res.json().catch(() => ({}));
      return { valid: false, reason: reply.error ?? `http${res.status}` } as T;
    }
    throw new RetryLater(String(error.message ?? error));
  }

  return {
    signIn,
    async issue(mode: Mode): Promise<ServerTicket> {
      const t = await call<ServerTicket & { valid?: boolean }>('issue-run', { mode });
      if (!t || typeof t.ticketId !== 'string') throw new RetryLater('noTicket');
      return t;
    },
    submit(run: PendingRun): Promise<Verdict> {
      return call<Verdict>('submit-run', {
        ticketId: run.ticketId,
        flaps: run.flaps,
        endTick: run.endTick,
        clientScore: run.clientScore,
      });
    },
    async profile() {
      if (!userId && !(await signIn())) return null;
      const { data } = await sb.from('profiles').select('nickname_id, tag').eq('id', userId!).maybeSingle();
      return data ? { nicknameId: data.nickname_id as number, tag: data.tag as number } : null;
    },
    async setNickname(nicknameId: number) {
      if (!userId && !(await signIn())) return false;
      const { data } = await sb.from('profiles').select('id').eq('id', userId!).maybeSingle();
      const { error } = data
        ? await sb.from('profiles').update({ nickname_id: nicknameId }).eq('id', userId!)
        : await sb.from('profiles').insert({ id: userId!, nickname_id: nicknameId });
      return !error;
    },
    async leaderboard(mode, rulesetId) {
      const { data, error } = await sb.rpc('get_leaderboard', { p_mode: mode, p_ruleset: rulesetId, p_limit: 20 });
      return error || !data ? [] : (data as BoardRow[]);
    },
    async myBest(mode, rulesetId) {
      if (!userId) return null;
      const { data, error } = await sb.rpc('get_my_best', { p_mode: mode, p_ruleset: rulesetId });
      const row = !error && Array.isArray(data) ? data[0] : null;
      return row ? { rank: row.rank as number, score: row.score as number } : null;
    },
    async impactTotal() {
      const { data, error } = await sb.rpc('get_impact_total');
      return error || data === null ? null : Number(data);
    },
  };
}
