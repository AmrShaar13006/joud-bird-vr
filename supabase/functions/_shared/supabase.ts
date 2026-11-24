// The Supabase side of the Edge Functions: the service client, the signed-in player, the
// `Db` implementation over the SQL functions in supabase/migrations, CORS and JSON replies.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.119.2';
import type { Db, IssueResult, Reply, RunRow, StoredRun, Ticket } from './types.ts';
import { MAX_BODY_BYTES } from './types.ts';

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(reply: Reply): Response {
  return Response.json(reply.body, { status: reply.status, headers: cors });
}

/** Service client (bypasses RLS): the new secret key when present, else the legacy one. */
export function adminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')!;
  let key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const secrets = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (secrets) {
    try {
      key = JSON.parse(secrets).default ?? key;
    } catch {
      // keep the legacy key
    }
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** The signed-in player's id from the Authorization bearer token, or null. */
export async function playerId(req: Request, admin: SupabaseClient): Promise<string | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  return error || !data.user ? null : data.user.id;
}

/** The request's JSON body, or undefined if it is too large or not JSON. */
export async function readBody(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function supabaseDb(admin: SupabaseClient): Db {
  return {
    async issueTicket(userId, rulesetId, mode, seed, ttlSeconds) {
      const { data, error } = await admin.rpc('issue_ticket', {
        p_user: userId,
        p_ruleset: rulesetId,
        p_mode: mode,
        p_seed: seed,
        p_ttl: `${ttlSeconds} seconds`,
      });
      if (error) throw error;
      return data as IssueResult;
    },
    async getTicket(id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
      const { data, error } = await admin.from('run_tickets').select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      return data as Ticket | null;
    },
    async findRunByTicket(ticketId) {
      const { data, error } = await admin
        .from('runs')
        .select('id, user_id, flaps, end_tick, valid, reason, score, obstacle_points, flowers, impact, end_reason')
        .eq('ticket_id', ticketId)
        .maybeSingle();
      if (error) throw error;
      return data as StoredRun | null;
    },
    async recordRun(r: RunRow) {
      const { data, error } = await admin.rpc('record_run', {
        p_ticket: r.ticketId,
        p_user: r.userId,
        p_ruleset: r.rulesetId,
        p_mode: r.mode,
        p_seed: r.seed,
        p_flaps: r.flaps,
        p_end_tick: r.endTick,
        p_valid: r.valid,
        p_reason: r.reason,
        p_score: r.score,
        p_obstacle_points: r.obstaclePoints,
        p_flowers: r.flowers,
        p_impact: r.impact,
        p_end_reason: r.endReason,
        p_hash: r.hash,
        p_client_score: r.clientScore,
      });
      if (error) throw error;
      return data as { runId: number; valid: boolean; reason: string | null };
    },
  };
}

/** Shared request plumbing: CORS preflight, POST only, a signed-in player, JSON body. */
export async function serve(
  req: Request,
  handle: (db: Db, userId: string, body: unknown) => Promise<Reply>,
): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ status: 405, body: { error: 'POST only' } });
  const admin = adminClient();
  const user = await playerId(req, admin);
  if (!user) return json({ status: 401, body: { error: 'signIn' } });
  const body = await readBody(req);
  if (body === undefined) return json({ status: 400, body: { error: 'badRequest' } });
  try {
    return json(await handle(supabaseDb(admin), user, body));
  } catch (e) {
    console.error(e);
    return json({ status: 500, body: { error: 'server' } });
  }
}
