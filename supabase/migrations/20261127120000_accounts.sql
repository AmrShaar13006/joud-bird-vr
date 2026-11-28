-- Joud Bird Mobile, phase 3: student accounts (docs/server.md, docs/accounts-runbook.md).
-- Accounts are YU email + passcode, made only by the sign-up Edge Function. Personal data lives
-- in `students` and `participations`; the email stays in auth.users. Public names are picked by
-- the student from generated suggestions and built here from ids, never from text the phone sends.
-- Deleting an account keeps its runs with user_id null, so the impact total never drops.

-- ---------- public lists: nouns, adjectives, colleges, majors, events ----------
-- Nouns carry a grammatical form so the adjective agrees. ندى is retired (kept for old rows).
alter table public.nicknames add column form text check (form in ('m', 'f'));
alter table public.nicknames add column active boolean not null default true;
insert into public.nicknames (id, label, form, active) values
  (1, 'وردة', 'f', true), (2, 'زهرة', 'f', true), (3, 'ياسمينة', 'f', true),
  (4, 'نرجسة', 'f', true), (5, 'خزامى', 'f', true), (6, 'بنفسجة', 'f', true),
  (7, 'سوسنة', 'f', true), (8, 'أقحوانة', 'f', true), (9, 'نخلة', 'f', true),
  (10, 'غيمة', 'f', true), (11, 'نجمة', 'f', true), (12, 'هلال', 'm', true),
  (13, 'بذرة', 'f', true), (14, 'ثمرة', 'f', true), (15, 'غصن', 'm', true),
  (16, 'ورقة', 'f', true), (17, 'ندى', 'm', false), (18, 'نسمة', 'f', true),
  (19, 'قطرة', 'f', true), (20, 'ريشة', 'f', true), (21, 'جناح', 'm', true),
  (22, 'عصفور', 'm', true), (23, 'حمامة', 'f', true), (24, 'بلبل', 'm', true),
  (25, 'نجم', 'm', true), (26, 'قمر', 'm', true), (27, 'غيث', 'm', true),
  (28, 'نسيم', 'm', true), (29, 'فجر', 'm', true), (30, 'شهاب', 'm', true),
  (31, 'سحاب', 'm', true), (32, 'ربيع', 'm', true)
on conflict (id) do update set label = excluded.label, form = excluded.form, active = excluded.active;
alter table public.nicknames alter column form set not null;

create table public.adjectives (
  id smallint primary key,
  masc text not null unique,
  fem text not null unique,
  active boolean not null default true
);
insert into public.adjectives (id, masc, fem) values
  (1, 'مشرق', 'مشرقة'), (2, 'سعيد', 'سعيدة'), (3, 'كريم', 'كريمة'),
  (4, 'نشيط', 'نشيطة'), (5, 'لامع', 'لامعة'), (6, 'هادئ', 'هادئة'),
  (7, 'شجاع', 'شجاعة'), (8, 'ذكي', 'ذكية'), (9, 'جميل', 'جميلة'),
  (10, 'مبدع', 'مبدعة'), (11, 'وفي', 'وفية'), (12, 'نبيل', 'نبيلة'),
  (13, 'باسم', 'باسمة'), (14, 'عطر', 'عطرة'), (15, 'سريع', 'سريعة'),
  (16, 'مزهر', 'مزهرة'), (17, 'حالم', 'حالمة'), (18, 'مضيء', 'مضيئة'),
  (19, 'بهي', 'بهية'), (20, 'رشيق', 'رشيقة'), (21, 'واثق', 'واثقة'),
  (22, 'خيّر', 'خيّرة'), (23, 'أصيل', 'أصيلة'), (24, 'طيّب', 'طيّبة'),
  (25, 'مرح', 'مرحة'), (26, 'صادق', 'صادقة'), (27, 'فريد', 'فريدة'),
  (28, 'لطيف', 'لطيفة'), (29, 'ساطع', 'ساطعة'), (30, 'حنون', 'حنونة');

-- Codes are stable; labels can be corrected after the registrar check without a deploy.
create table public.colleges (
  code text primary key,
  name_ar text not null,
  name_en text not null,
  sort smallint not null,
  active boolean not null default true
);
insert into public.colleges (code, name_ar, name_en, sort) values
  ('BUS', 'كلية إدارة الأعمال', 'College of Business Administration', 1),
  ('ENG', 'كلية الهندسة والعمارة', 'College of Engineering and Architecture', 2),
  ('LAW', 'كلية القانون', 'College of Law', 3);

create table public.majors (
  code text primary key,
  college_code text not null references public.colleges (code),
  name_ar text not null,
  name_en text not null,
  sort smallint not null,
  active boolean not null default true,
  unique (code, college_code)
);
insert into public.majors (code, college_code, name_ar, name_en, sort) values
  ('BUS-ACC', 'BUS', 'المحاسبة', 'Accounting', 1),
  ('BUS-FIN', 'BUS', 'التمويل', 'Finance', 2),
  ('BUS-MGT', 'BUS', 'الإدارة', 'Management', 3),
  ('BUS-MKT', 'BUS', 'التسويق', 'Marketing', 4),
  ('BUS-MIS', 'BUS', 'نظم المعلومات الإدارية', 'Management Information Systems', 5),
  ('ENG-ARC', 'ENG', 'العمارة', 'Architecture', 1),
  ('ENG-SWE', 'ENG', 'هندسة البرمجيات', 'Software Engineering', 2),
  ('ENG-NES', 'ENG', 'هندسة الشبكات والأمن', 'Network Engineering and Security', 3),
  ('ENG-IND', 'ENG', 'الهندسة الصناعية', 'Industrial Engineering', 4),
  ('LAW', 'LAW', 'القانون', 'Law', 1);

-- One row per campaign. The donation rate and cap are read by the phone, never hard-coded.
create table public.events (
  code text primary key,
  name_ar text not null,
  starts_on date,
  ends_on date,
  impact_per_riyal integer not null check (impact_per_riyal > 0),
  riyal_cap integer not null check (riyal_cap > 0),
  active boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index events_one_active on public.events (active) where active;
insert into public.events (code, name_ar, impact_per_riyal, riyal_cap, active) values
  ('joud-2026', 'حملة جود 2026', 100, 1000, true);

-- ---------- students: the only personal data besides the email in auth.users ----------
-- Made empty-ish by the sign-up function (enrolment year from the email); filled by save_profile.
create table public.students (
  user_id uuid primary key references auth.users (id) on delete cascade,
  enrol_year smallint not null check (enrol_year between 2000 and 2100),
  gender text check (gender in ('m', 'f')),
  college_code text references public.colleges (code),
  major_code text,
  interlink boolean,
  complete boolean generated always as (
    gender is not null and college_code is not null and major_code is not null and interlink is not null
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (major_code, college_code) references public.majors (code, college_code)
);

-- The profile as it was in each event. Written on profile save and on the first ranked
-- ticket in an event, so a returning student gets a row in every event they play.
create table public.participations (
  user_id uuid not null references auth.users (id) on delete cascade,
  event_code text not null references public.events (code),
  college_code text not null references public.colleges (code),
  major_code text not null,
  interlink boolean not null,
  joined_at timestamptz not null default now(),
  primary key (user_id, event_code),
  foreign key (major_code, college_code) references public.majors (code, college_code)
);

-- ---------- public names: (noun, adjective, tag), unique, claimed by the student ----------
alter table public.profiles add column adjective_id smallint references public.adjectives (id);
alter table public.profiles add column renamed_on date;
alter table public.profiles add column renames smallint not null default 0;
update public.profiles set adjective_id = (1 + floor(random() * 30))::smallint where adjective_id is null;
alter table public.profiles alter column adjective_id set not null;
alter table public.profiles alter column tag drop default;
create unique index profiles_name_unique on public.profiles (nickname_id, adjective_id, tag);

-- ---------- runs outlive their account ----------
-- Delete my account: everything personal goes, the runs stay anonymous so the impact total
-- never drops. The leaderboard skips them (no user); get_impact_total still counts them.
alter table public.runs alter column user_id drop not null;
alter table public.runs drop constraint runs_user_id_fkey;
alter table public.runs add constraint runs_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete set null;

-- ---------- row-level security ----------
alter table public.adjectives enable row level security;
alter table public.colleges enable row level security;
alter table public.majors enable row level security;
alter table public.events enable row level security;
alter table public.students enable row level security;
alter table public.participations enable row level security;

create policy "adjectives are public" on public.adjectives for select to anon, authenticated using (true);
create policy "colleges are public" on public.colleges for select to anon, authenticated using (true);
create policy "majors are public" on public.majors for select to anon, authenticated using (true);
create policy "events are public" on public.events for select to anon, authenticated using (true);
create policy "read own student row" on public.students
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "read own participations" on public.participations
  for select to authenticated using ((select auth.uid()) = user_id);

-- Names change only through claim_name now.
drop policy "create own profile" on public.profiles;
drop policy "rename own profile" on public.profiles;
revoke insert, update, delete, truncate on public.profiles from authenticated;

revoke insert, update, delete, truncate on
  public.adjectives, public.colleges, public.majors, public.events from anon, authenticated;
revoke all on public.students, public.participations from anon;
revoke insert, update, delete, truncate on public.students, public.participations from authenticated;

-- ---------- internal helpers (not callable through the API) ----------
-- «noun adjective tag», the adjective in the noun's form. The only place a name is spelled.
create function public.name_label(p_nickname smallint, p_adjective smallint, p_tag smallint)
returns text
language sql stable set search_path = ''
as $$
  select n.label || ' ' || case n.form when 'm' then a.masc else a.fem end || ' ' || p_tag::text
  from public.nicknames n, public.adjectives a
  where n.id = p_nickname and a.id = p_adjective;
$$;

-- Best valid run per eligible player (complete profile and a name); ties go to whoever got
-- there first. Runs of deleted accounts (no user) never appear.
create function public.ranked_best(p_mode text, p_ruleset text)
returns table (user_id uuid, score integer, achieved_at timestamptz, rank integer)
language sql stable set search_path = ''
as $$
  with best as (
    select distinct on (r.user_id) r.user_id, r.score, r.submitted_at
    from public.runs r
    join public.students s on s.user_id = r.user_id and s.complete
    join public.profiles p on p.id = r.user_id
    where r.valid and r.mode = p_mode and r.ruleset_id = p_ruleset
    order by r.user_id, r.score desc, r.submitted_at asc
  )
  select b.user_id, b.score, b.submitted_at,
         (row_number() over (order by b.score desc, b.submitted_at asc))::integer
  from best b;
$$;

revoke execute on function public.name_label(smallint, smallint, smallint) from public, anon, authenticated;
revoke execute on function public.ranked_best(text, text) from public, anon, authenticated;

-- ---------- sign-up (service role only, called by the sign-up Edge Function) ----------
-- A soft project-wide cap: at most 30 new accounts a minute.
create function public.sign_up_allowed()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select count(*) < 30 from auth.users where created_at > now() - interval '1 minute';
$$;

create function public.create_account(p_user uuid, p_enrol_year smallint)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.students (user_id, enrol_year) values (p_user, p_enrol_year);
$$;

-- ---------- the signed-in student ----------
-- Errors are raised with a reason code as the message (HTTP 400 through the API).
create function public.save_profile(p_college text, p_major text, p_interlink boolean, p_gender text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if not exists (select 1 from public.students where user_id = v_user) then
    raise exception 'needsAccount';
  end if;
  if p_gender is null or p_gender not in ('m', 'f') or p_interlink is null
     or not exists (select 1 from public.colleges where code = p_college and active)
     or not exists (select 1 from public.majors where code = p_major and college_code = p_college and active) then
    raise exception 'badProfile';
  end if;
  update public.students
    set college_code = p_college, major_code = p_major, interlink = p_interlink, gender = p_gender,
        updated_at = now()
    where user_id = v_user;
  -- This event's copy follows corrections made during the event.
  insert into public.participations (user_id, event_code, college_code, major_code, interlink)
    select v_user, e.code, p_college, p_major, p_interlink from public.events e where e.active
    on conflict (user_id, event_code) do update
      set college_code = excluded.college_code, major_code = excluded.major_code, interlink = excluded.interlink;
  return jsonb_build_object('ok', true);
end;
$$;

-- Claims a name the phone drew from the public lists. A name someone else holds fails on the
-- unique index (unique_violation → HTTP 409); the phone then offers new suggestions.
-- The first claim is free; changes after it: at most 5 a day (Riyadh time).
create function public.claim_name(p_nickname smallint, p_adjective smallint, p_tag smallint)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  v_row public.profiles;
begin
  if not exists (select 1 from public.students where user_id = v_user) then
    raise exception 'needsAccount';
  end if;
  if p_tag is null or p_tag not between 10 and 99
     or not exists (select 1 from public.nicknames where id = p_nickname and active)
     or not exists (select 1 from public.adjectives where id = p_adjective and active) then
    raise exception 'badName';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 1));
  select * into v_row from public.profiles where id = v_user;
  if not found then
    insert into public.profiles (id, nickname_id, adjective_id, tag)
      values (v_user, p_nickname, p_adjective, p_tag);
  elsif (v_row.nickname_id, v_row.adjective_id, v_row.tag) is distinct from (p_nickname, p_adjective, p_tag) then
    if v_row.renamed_on = v_today and v_row.renames >= 5 then
      raise exception 'tooManyRenames';
    end if;
    update public.profiles
      set nickname_id = p_nickname, adjective_id = p_adjective, tag = p_tag,
          renames = case when renamed_on = v_today then renames + 1 else 1 end,
          renamed_on = v_today
      where id = v_user;
  end if;
  return jsonb_build_object('name', public.name_label(p_nickname, p_adjective, p_tag));
end;
$$;

-- Everything the account screen shows. Null when the caller has no account.
create function public.get_me()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'email', u.email,
    'enrolYear', s.enrol_year,
    'college', s.college_code,
    'major', s.major_code,
    'interlink', s.interlink,
    'gender', s.gender,
    'profileComplete', coalesce(s.complete, false),
    'name', case when p.id is null then null else public.name_label(p.nickname_id, p.adjective_id, p.tag) end,
    'renamesLeft', case
      when p.renamed_on = (now() at time zone 'Asia/Riyadh')::date then greatest(0, 5 - p.renames)
      else 5 end)
  from auth.users u
  join public.students s on s.user_id = u.id
  left join public.profiles p on p.id = u.id
  where u.id = (select auth.uid());
$$;

-- ---------- ranked play: tickets only for a complete profile with a name ----------
-- Same as 20261124120000_ranked_runs.sql plus the needsProfile check and the participation row.
create or replace function public.issue_ticket(
  p_user uuid, p_ruleset text, p_mode text, p_seed bigint, p_ttl interval
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_open integer;
  v_hour integer;
  v_row public.run_tickets;
begin
  if not exists (select 1 from public.students s join public.profiles p on p.id = s.user_id
                 where s.user_id = p_user and s.complete) then
    return jsonb_build_object('ok', false, 'reason', 'needsProfile');
  end if;
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
  insert into public.participations (user_id, event_code, college_code, major_code, interlink)
    select s.user_id, e.code, s.college_code, s.major_code, s.interlink
    from public.students s cross join public.events e
    where s.user_id = p_user and e.active
    on conflict (user_id, event_code) do nothing;
  insert into public.run_tickets (user_id, ruleset_id, mode, seed, expires_at)
    values (p_user, p_ruleset, p_mode, p_seed, now() + p_ttl)
    returning * into v_row;
  return jsonb_build_object(
    'ok', true, 'ticketId', v_row.id, 'rulesetId', v_row.ruleset_id, 'mode', v_row.mode,
    'seed', v_row.seed, 'issuedAt', v_row.issued_at, 'expiresAt', v_row.expires_at);
end;
$$;

-- ---------- public reads, now with generated names ----------
create or replace function public.get_leaderboard(p_mode text, p_ruleset text default 'mobile-1', p_limit integer default 20)
returns table (rank integer, nickname text, score integer, achieved_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select b.rank, public.name_label(p.nickname_id, p.adjective_id, p.tag), b.score, b.achieved_at
  from public.ranked_best(p_mode, p_ruleset) b
  join public.profiles p on p.id = b.user_id
  order by b.rank
  limit least(greatest(p_limit, 1), 50);
$$;

drop function public.get_my_best(text, text);
create function public.get_my_best(p_mode text, p_ruleset text default 'mobile-1')
returns table (rank integer, score integer, name text)
language sql stable security definer set search_path = ''
as $$
  select b.rank, b.score, public.name_label(p.nickname_id, p.adjective_id, p.tag)
  from public.ranked_best(p_mode, p_ruleset) b
  join public.profiles p on p.id = b.user_id
  where b.user_id = (select auth.uid());
$$;

-- ---------- officers (service role: SQL editor or scripts/admin) ----------
create function public.winner_contacts(p_mode text, p_ruleset text default 'mobile-1', p_limit integer default 10)
returns table (rank integer, name text, email text, college_code text, enrol_year smallint, score integer, achieved_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select b.rank, public.name_label(p.nickname_id, p.adjective_id, p.tag), u.email::text,
         s.college_code, s.enrol_year, b.score, b.achieved_at
  from public.ranked_best(p_mode, p_ruleset) b
  join public.profiles p on p.id = b.user_id
  join public.students s on s.user_id = b.user_id
  join auth.users u on u.id = b.user_id
  order by b.rank
  limit least(greatest(p_limit, 1), 100);
$$;

-- ---------- grants ----------
revoke execute on function public.sign_up_allowed() from public, anon, authenticated;
revoke execute on function public.create_account(uuid, smallint) from public, anon, authenticated;
revoke execute on function public.winner_contacts(text, text, integer) from public, anon, authenticated;
grant execute on function public.sign_up_allowed() to service_role;
grant execute on function public.create_account(uuid, smallint) to service_role;
grant execute on function public.winner_contacts(text, text, integer) to service_role;

revoke execute on function public.save_profile(text, text, boolean, text) from public, anon;
revoke execute on function public.claim_name(smallint, smallint, smallint) from public, anon;
revoke execute on function public.get_me() from public, anon;
revoke execute on function public.get_my_best(text, text) from public, anon;
grant execute on function public.save_profile(text, text, boolean, text) to authenticated;
grant execute on function public.claim_name(smallint, smallint, smallint) to authenticated;
grant execute on function public.get_me() to authenticated;
grant execute on function public.get_my_best(text, text) to authenticated;
