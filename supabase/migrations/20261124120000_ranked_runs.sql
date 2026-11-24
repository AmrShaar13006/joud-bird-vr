-- Joud Bird Mobile, step 2: ranked runs verified by server replay.
-- No personal data: anonymous auth users, a nickname picked from a fixed list, a 2-digit tag.
-- Tickets and runs are written only by the Edge Functions (service role) through the
-- security-definer functions below; players read their own rows and the public leaderboard.

-- ---------- nicknames (fixed list; no free text, nothing to moderate) ----------
create table public.nicknames (
  id smallint primary key,
  label text not null unique
);
insert into public.nicknames (id, label) values
  (1, 'وردة'), (2, 'زهرة'), (3, 'ياسمينة'), (4, 'نرجسة'), (5, 'خزامى'), (6, 'بنفسجة'),
  (7, 'سوسنة'), (8, 'أقحوانة'), (9, 'نخلة'), (10, 'غيمة'), (11, 'نجمة'), (12, 'هلال'),
  (13, 'بذرة'), (14, 'ثمرة'), (15, 'غصن'), (16, 'ورقة'), (17, 'ندى'), (18, 'نسمة'),
  (19, 'قطرة'), (20, 'ريشة'), (21, 'جناح'), (22, 'عصفور'), (23, 'حمامة'), (24, 'بلبل');

-- ---------- profiles ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname_id smallint not null references public.nicknames (id),
  -- Shown after the nickname («وردة 27») so equal nicknames stay apart.
  tag smallint not null default (10 + floor(random() * 90))::smallint check (tag between 10 and 99),
  created_at timestamptz not null default now()
);

-- ---------- run tickets: one server-issued seed per ranked round ----------
create table public.run_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  ruleset_id text not null,
  mode text not null check (mode in ('easy', 'normal', 'hard')),
  seed bigint not null check (seed between 0 and 4294967295),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index run_tickets_user_issued on public.run_tickets (user_id, issued_at desc);

-- ---------- runs: every submission, valid or not ----------
create table public.runs (
  id bigint generated always as identity primary key,
  -- Null when the submission named no usable ticket (unknown, someone else's, already used).
  ticket_id uuid unique references public.run_tickets (id) on delete set null,
  user_id uuid not null references auth.users (id) on delete cascade,
  ruleset_id text not null,
  mode text not null,
  seed bigint not null,
  flaps integer[] not null,
  end_tick integer not null,
  valid boolean not null,
  reason text,
  score integer not null default 0,
  obstacle_points integer not null default 0,
  flowers integer not null default 0,
  impact integer not null default 0,
  end_reason text,
  hash text,
  client_score integer,
  submitted_at timestamptz not null default now()
);
create index runs_board on public.runs (ruleset_id, mode, user_id, score desc, submitted_at)
  where valid;
create index runs_user on public.runs (user_id, submitted_at desc);

-- ---------- row-level security ----------
alter table public.nicknames enable row level security;
alter table public.profiles enable row level security;
alter table public.run_tickets enable row level security;
alter table public.runs enable row level security;

create policy "nicknames are public" on public.nicknames
  for select to anon, authenticated using (true);

create policy "read own profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "create own profile" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);
create policy "rename own profile" on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "read own tickets" on public.run_tickets
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "read own runs" on public.runs
  for select to authenticated using ((select auth.uid()) = user_id);

-- Defence in depth: players never write tickets or runs, and only pick a nickname.
revoke insert, update, delete, truncate on public.run_tickets, public.runs from anon, authenticated;
revoke insert, update, delete, truncate on public.nicknames from anon, authenticated;
revoke all on public.profiles from anon;
revoke update on public.profiles from authenticated;
grant update (nickname_id) on public.profiles to authenticated;

-- ---------- tickets (service role only) ----------
-- Issues a ticket unless the player has 3 open tickets or 120 in the last hour.
create function public.issue_ticket(
  p_user uuid, p_ruleset text, p_mode text, p_seed bigint, p_ttl interval
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_open integer;
  v_hour integer;
  v_row public.run_tickets;
begin
  -- One player at a time, so two parallel requests can't both pass the limits.
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
  select count(*) into v_open from public.run_tickets
    where user_id = p_user and used_at is null and expires_at > now();
  if v_open >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'tooManyOpen');
  end if;
  select count(*) into v_hour from public.run_tickets
    where user_id = p_user and issued_at > now() - interval '1 hour';
  if v_hour >= 120 then
    return jsonb_build_object('ok', false, 'reason', 'tooManyPerHour');
  end if;
  insert into public.run_tickets (user_id, ruleset_id, mode, seed, expires_at)
    values (p_user, p_ruleset, p_mode, p_seed, now() + p_ttl)
    returning * into v_row;
  return jsonb_build_object(
    'ok', true, 'ticketId', v_row.id, 'rulesetId', v_row.ruleset_id, 'mode', v_row.mode,
    'seed', v_row.seed, 'issuedAt', v_row.issued_at, 'expiresAt', v_row.expires_at);
end;
$$;

-- Stores a checked run. Consumes the ticket in the same transaction; if the ticket was used
-- meanwhile, the run is stored as invalid (ticketUsed) without a ticket.
create function public.record_run(
  p_ticket uuid, p_user uuid, p_ruleset text, p_mode text, p_seed bigint,
  p_flaps integer[], p_end_tick integer, p_valid boolean, p_reason text,
  p_score integer, p_obstacle_points integer, p_flowers integer, p_impact integer,
  p_end_reason text, p_hash text, p_client_score integer
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_ticket uuid := null;
  v_valid boolean := p_valid;
  v_reason text := p_reason;
  v_id bigint;
begin
  if p_ticket is not null then
    update public.run_tickets set used_at = now()
      where id = p_ticket and user_id = p_user and used_at is null
      returning id into v_ticket;
    if v_ticket is null then
      v_valid := false;
      v_reason := 'ticketUsed';
    end if;
  end if;
  insert into public.runs (
    ticket_id, user_id, ruleset_id, mode, seed, flaps, end_tick, valid, reason,
    score, obstacle_points, flowers, impact, end_reason, hash, client_score)
  values (
    v_ticket, p_user, p_ruleset, p_mode, p_seed, p_flaps, p_end_tick, v_valid, v_reason,
    case when v_valid then p_score else 0 end,
    case when v_valid then p_obstacle_points else 0 end,
    case when v_valid then p_flowers else 0 end,
    case when v_valid then p_impact else 0 end,
    p_end_reason, p_hash, p_client_score)
  returning id into v_id;
  return jsonb_build_object('runId', v_id, 'valid', v_valid, 'reason', v_reason);
end;
$$;

revoke execute on function public.issue_ticket(uuid, text, text, bigint, interval) from public, anon, authenticated;
revoke execute on function public.record_run(uuid, uuid, text, text, bigint, integer[], integer, boolean, text, integer, integer, integer, integer, text, text, integer) from public, anon, authenticated;
grant execute on function public.issue_ticket(uuid, text, text, bigint, interval) to service_role;
grant execute on function public.record_run(uuid, uuid, text, text, bigint, integer[], integer, boolean, text, integer, integer, integer, integer, text, text, integer) to service_role;

-- ---------- public reads ----------
-- Best valid run per player in a mode; ties go to whoever got there first.
create function public.get_leaderboard(p_mode text, p_ruleset text default 'mobile-1', p_limit integer default 20)
returns table (rank integer, nickname text, score integer, achieved_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  with best as (
    select distinct on (r.user_id) r.user_id, r.score, r.submitted_at
    from public.runs r
    where r.valid and r.mode = p_mode and r.ruleset_id = p_ruleset
    order by r.user_id, r.score desc, r.submitted_at asc
  )
  select (row_number() over (order by b.score desc, b.submitted_at asc))::integer,
         n.label || ' ' || p.tag::text,
         b.score,
         b.submitted_at
  from best b
  join public.profiles p on p.id = b.user_id
  join public.nicknames n on n.id = p.nickname_id
  order by b.score desc, b.submitted_at asc
  limit least(greatest(p_limit, 1), 50);
$$;

-- The signed-in player's best and rank in a mode (null rows when they have no valid run).
create function public.get_my_best(p_mode text, p_ruleset text default 'mobile-1')
returns table (rank integer, score integer)
language sql stable security definer set search_path = ''
as $$
  with best as (
    select distinct on (r.user_id) r.user_id, r.score, r.submitted_at
    from public.runs r
    where r.valid and r.mode = p_mode and r.ruleset_id = p_ruleset
    order by r.user_id, r.score desc, r.submitted_at asc
  ), me as (
    select * from best where user_id = (select auth.uid())
  )
  select (1 + (select count(*) from best b
               where b.score > me.score or (b.score = me.score and b.submitted_at < me.submitted_at)))::integer,
         me.score
  from me;
$$;

-- The campaign's impact total («مجموع نقاط الأثر»): every valid ranked run, all modes.
create function public.get_impact_total()
returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(impact), 0)::bigint from public.runs where valid;
$$;

revoke execute on function public.get_leaderboard(text, text, integer) from public;
revoke execute on function public.get_my_best(text, text) from public;
revoke execute on function public.get_impact_total() from public;
grant execute on function public.get_leaderboard(text, text, integer) to anon, authenticated;
grant execute on function public.get_my_best(text, text) to authenticated;
grant execute on function public.get_impact_total() to anon, authenticated;
