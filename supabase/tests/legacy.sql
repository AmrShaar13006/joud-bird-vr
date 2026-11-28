-- Data as it was before the accounts migration: one anonymous player with a profile and a run.
-- Runs between the 20261124 migrations and 20261127120000_accounts.sql.
insert into auth.users (id, is_anonymous) values ('aaaaaaaa-0000-0000-0000-000000000000', true);
insert into public.profiles (id, nickname_id) values ('aaaaaaaa-0000-0000-0000-000000000000', 1);
select public.record_run(null, 'aaaaaaaa-0000-0000-0000-000000000000', 'mobile-1', 'normal', 1, '{10,20}', 100, true, null, 40, 40, 0, 80, 'hit', 'h', 40);
