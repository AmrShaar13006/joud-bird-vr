-- SQL tests for 20261127120000_accounts.sql: names, profiles, tickets, boards, grants, deletion.
-- Run after stub.sql, the migrations and legacy.sql on a throwaway database (docs/server.md).
\set ON_ERROR_STOP 1
-- Expect an error with a given SQLSTATE (and optional message) from a statement.
create function pg_temp.expect_error(stmt text, state text, msg text default null) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'expected % from: %', state, stmt;
exception when others then
  if sqlstate <> state or (msg is not null and sqlerrm <> msg) then
    raise exception 'got % "%" (expected % %) from: %', sqlstate, sqlerrm, state, msg, stmt;
  end if;
end $$;
grant execute on function pg_temp.expect_error(text, text, text) to anon, authenticated, service_role;
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;
grant execute on function pg_temp.check(boolean, text) to anon, authenticated, service_role;

-- Legacy row kept, backfilled, and off the board.
select pg_temp.check((select adjective_id is not null from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000000'), 'legacy profile backfilled');
select pg_temp.check((select count(*) = 31 from public.nicknames where active), '31 active nouns');
select pg_temp.check((select count(*) = 13 from public.nicknames where active and form = 'm'), '13 masculine nouns');
select pg_temp.check((select count(*) = 30 from public.adjectives where active), '30 adjectives');

-- Three students (the sign-up function does this as service_role).
insert into auth.users (id, email) values
  ('11111111-0000-0000-0000-000000000000', '202312345@yu.edu.sa'),
  ('22222222-0000-0000-0000-000000000000', '202254321@yu.edu.sa'),
  ('33333333-0000-0000-0000-000000000000', '202411111@yu.edu.sa');
set role service_role;
select pg_temp.check(public.sign_up_allowed(), 'sign-up allowed under the cap');
select public.create_account('11111111-0000-0000-0000-000000000000', 2023::smallint);
select public.create_account('22222222-0000-0000-0000-000000000000', 2022::smallint);
select public.create_account('33333333-0000-0000-0000-000000000000', 2024::smallint);
reset role;

-- Student 1
set role authenticated; set request.jwt.claim.sub = '11111111-0000-0000-0000-000000000000';
select pg_temp.expect_error($$select public.save_profile('BUS', 'ENG-SWE', false, 'f')$$, 'P0001', 'badProfile');
select pg_temp.expect_error($$select public.save_profile('BUS', 'BUS-ACC', null, 'f')$$, 'P0001', 'badProfile');
select pg_temp.expect_error($$select public.save_profile('BUS', 'BUS-ACC', false, 'x')$$, 'P0001', 'badProfile');
select public.save_profile('BUS', 'BUS-ACC', false, 'f');
select pg_temp.check((select complete from public.students), 'profile complete');
select pg_temp.check((select count(*) = 1 from public.participations where event_code = 'joud-2026'), 'participation on profile save');
select pg_temp.check((public.claim_name(1::smallint, 1::smallint, 27::smallint)->>'name') = 'وردة مشرقة 27', 'claim feminine name');
select pg_temp.expect_error($$select public.claim_name(17::smallint, 1::smallint, 27::smallint)$$, 'P0001', 'badName');
select pg_temp.expect_error($$select public.claim_name(1::smallint, 99::smallint, 27::smallint)$$, 'P0001', 'badName');
select pg_temp.expect_error($$select public.claim_name(1::smallint, 1::smallint, 9::smallint)$$, 'P0001', 'badName');
select pg_temp.expect_error($$select public.claim_name(1::smallint, 1::smallint, 100::smallint)$$, 'P0001', 'badName');
-- 5 changes a day, then refused; the current name again is never refused.
select public.claim_name(1::smallint, 2::smallint, 27::smallint);
select public.claim_name(1::smallint, 3::smallint, 27::smallint);
select public.claim_name(1::smallint, 4::smallint, 27::smallint);
select public.claim_name(1::smallint, 5::smallint, 27::smallint);
select public.claim_name(1::smallint, 6::smallint, 27::smallint);
select pg_temp.check((public.get_me()->>'renamesLeft')::int = 0, 'renames left 0 after 5 changes');
select pg_temp.expect_error($$select public.claim_name(1::smallint, 7::smallint, 27::smallint)$$, 'P0001', 'tooManyRenames');
select pg_temp.check((public.claim_name(1::smallint, 6::smallint, 27::smallint)->>'name') = 'وردة هادئة 27', 'same name again is fine');
-- Own rows only, no direct writes.
select pg_temp.check((select count(*) = 1 from public.students), 'student sees only own row');
select pg_temp.expect_error($$update public.profiles set tag = 50$$, '42501');
select pg_temp.expect_error($$insert into public.students (user_id, enrol_year) values ('22222222-0000-0000-0000-000000000000', 2022)$$, '42501');
select pg_temp.expect_error($$select public.create_account('44444444-0000-0000-0000-000000000000', 2022::smallint)$$, '42501');
select pg_temp.expect_error($$select public.sign_up_allowed()$$, '42501');
select pg_temp.expect_error($$select * from public.winner_contacts('normal')$$, '42501');
select pg_temp.expect_error($$select * from public.ranked_best('normal', 'mobile-1')$$, '42501');
select pg_temp.expect_error($$select public.name_label(1::smallint, 1::smallint, 10::smallint)$$, '42501');
select pg_temp.check((public.get_me()->>'email') = '202312345@yu.edu.sa', 'get_me email');
select pg_temp.check((public.get_me()->>'name') = 'وردة هادئة 27', 'get_me name');
reset role; reset request.jwt.claim.sub;

-- Student 2: a taken name conflicts (409 through the API), a masculine noun agrees.
set role authenticated; set request.jwt.claim.sub = '22222222-0000-0000-0000-000000000000';
select public.save_profile('ENG', 'ENG-SWE', true, 'm');
select pg_temp.expect_error($$select public.claim_name(1::smallint, 6::smallint, 27::smallint)$$, '23505');
select pg_temp.check((public.claim_name(12::smallint, 6::smallint, 27::smallint)->>'name') = 'هلال هادئ 27', 'claim masculine name');
select pg_temp.check((public.get_me()->>'renamesLeft')::int = 5, 'first claim is free');
reset role; reset request.jwt.claim.sub;

-- Student 3 never finishes the profile.
set role authenticated; set request.jwt.claim.sub = '33333333-0000-0000-0000-000000000000';
select pg_temp.check((public.claim_name(25::smallint, 1::smallint, 10::smallint)->>'name') = 'نجم مشرق 10', 'name before profile allowed');
reset role; reset request.jwt.claim.sub;

-- The legacy anonymous user can't claim a name.
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000000';
select pg_temp.expect_error($$select public.claim_name(2::smallint, 2::smallint, 33::smallint)$$, 'P0001', 'needsAccount');
select pg_temp.expect_error($$select public.save_profile('LAW', 'LAW', false, 'm')$$, 'P0001', 'needsAccount');
select pg_temp.check(public.get_me() is null, 'get_me null without account');
reset role; reset request.jwt.claim.sub;

-- Tickets: only complete profiles with a name; the ticket makes this event's participation.
set role service_role;
select pg_temp.check((public.issue_ticket('33333333-0000-0000-0000-000000000000', 'mobile-1', 'normal', 1, '30 minutes')->>'reason') = 'needsProfile', 'incomplete profile: needsProfile');
select pg_temp.check((public.issue_ticket('aaaaaaaa-0000-0000-0000-000000000000', 'mobile-1', 'normal', 1, '30 minutes')->>'reason') = 'needsProfile', 'anonymous: needsProfile');
reset role;
delete from public.participations where user_id = '22222222-0000-0000-0000-000000000000';
set role service_role;
select pg_temp.check((public.issue_ticket('22222222-0000-0000-0000-000000000000', 'mobile-1', 'normal', 7, '30 minutes')->>'ok')::boolean, 'complete profile gets a ticket');
reset role;
select pg_temp.check((select count(*) = 1 from public.participations where user_id = '22222222-0000-0000-0000-000000000000'), 'ticket creates the participation');

-- Runs and boards.
set role service_role;
select public.record_run(null, '11111111-0000-0000-0000-000000000000', 'mobile-1', 'normal', 2, '{1}', 10, true, null, 30, 30, 0, 60, 'hit', 'h', 30);
select public.record_run(null, '22222222-0000-0000-0000-000000000000', 'mobile-1', 'normal', 3, '{1}', 10, true, null, 50, 50, 0, 100, 'hit', 'h', 50);
select public.record_run(null, '33333333-0000-0000-0000-000000000000', 'mobile-1', 'normal', 4, '{1}', 10, true, null, 90, 90, 0, 180, 'hit', 'h', 90);
select pg_temp.check((select count(*) = 2 from public.winner_contacts('normal')), 'winners: complete profiles only');
select pg_temp.check((select email from public.winner_contacts('normal') where rank = 1) = '202254321@yu.edu.sa', 'winner email');
reset role;
set role anon;
select pg_temp.check((select string_agg(rank || ':' || nickname || ':' || score, ',' order by rank) from public.get_leaderboard('normal'))
  = '1:هلال هادئ 27:50,2:وردة هادئة 27:30', 'leaderboard: names, no legacy, no incomplete');
select pg_temp.check(public.get_impact_total() = 420, 'impact total counts every valid run');
select pg_temp.check((select count(*) = 3 from public.colleges), 'anon reads colleges');
select pg_temp.check((select impact_per_riyal = 100 and riyal_cap = 1000 from public.events where active), 'anon reads the donation rate');
select pg_temp.expect_error($$select * from public.students$$, '42501');
select pg_temp.expect_error($$select * from public.participations$$, '42501');
select pg_temp.expect_error($$select public.get_me()$$, '42501');
select pg_temp.expect_error($$select public.claim_name(1::smallint, 1::smallint, 11::smallint)$$, '42501');
select pg_temp.expect_error($$select * from public.get_my_best('normal')$$, '42501');
reset role;
set role authenticated; set request.jwt.claim.sub = '11111111-0000-0000-0000-000000000000';
select pg_temp.check((select rank = 2 and score = 30 and name = 'وردة هادئة 27' from public.get_my_best('normal')), 'my best with name');
reset role; reset request.jwt.claim.sub;

-- Delete my account: personal rows go, runs stay without a user, the total stays.
delete from auth.users where id = '22222222-0000-0000-0000-000000000000';
select pg_temp.check((select count(*) = 0 from public.students where user_id = '22222222-0000-0000-0000-000000000000'), 'student row deleted');
select pg_temp.check((select count(*) = 0 from public.participations where user_id = '22222222-0000-0000-0000-000000000000'), 'participations deleted');
select pg_temp.check((select count(*) = 0 from public.profiles where id = '22222222-0000-0000-0000-000000000000'), 'profile deleted');
select pg_temp.check((select count(*) = 0 from public.run_tickets where user_id = '22222222-0000-0000-0000-000000000000'), 'tickets deleted');
select pg_temp.check((select count(*) = 1 from public.runs where user_id is null and score = 50), 'run kept without a user');
select pg_temp.check(public.get_impact_total() = 420, 'impact total unchanged after delete');
select pg_temp.check((select string_agg(nickname, ',') from public.get_leaderboard('normal')) = 'وردة هادئة 27', 'deleted player off the board');
set role authenticated; set request.jwt.claim.sub = '33333333-0000-0000-0000-000000000000';
select pg_temp.check((public.claim_name(12::smallint, 6::smallint, 27::smallint)->>'name') = 'هلال هادئ 27', 'deleted name is free again');
reset role; reset request.jwt.claim.sub;
\echo ALL SQL CHECKS PASSED
