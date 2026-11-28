# Student accounts: officer runbook

For the named club officers who look after student accounts on the phone game. How accounts
work and who can see what: `docs/server.md`. Run every command from the repo folder on a
laptop with Node 22 and `npm ci` done.

## Setup (once per laptop)
1. Supabase dashboard → the project → **Project Settings → API Keys** → copy the project URL and
   a **secret** key (`sb_secret_…`; the legacy `service_role` key also works).
2. Create `.env.admin` in the repo folder:
   ```
   SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_SECRET_KEY=sb_secret_...
   ```
   `.env.*` is in `.gitignore`. Never commit it, paste it in chat or put it in a screenshot. The
   secret key bypasses every rule in the database.
3. Every command below starts with
   `node --env-file=.env.admin scripts/run-ts.mjs scripts/admin/accounts.ts`, written `accounts` here.

The script only uses Supabase Auth's admin API. Nobody writes to `auth.users` with SQL.

## Before acting on a student's email
Act only on an email that arrived **from the student's own YU address** (the one in the account).
Reply from the club's account, never from a personal one.

## Find the winners
SQL editor in the dashboard (read only), once per mode:
```sql
select * from public.winner_contacts('normal');          -- top 10; also 'easy', 'hard'
select * from public.winner_contacts('normal', 'mobile-1', 20);
```
It returns rank, public name, email, college, enrolment year, best score and when it was set.
Only accounts with a complete profile appear, as on the public board. Email each winner from the
club's YU account. At the final the winner signs in with their passcode and the account screen
shows the same public name and email. Take the full name on the prize form, not in Supabase.

## A student lost their passcode
1. `accounts find 202312345@yu.edu.sa` to confirm the account exists.
2. `accounts reset-passcode 202312345@yu.edu.sa <6–12 digits>`. Pick a random code, not
   123456 or 111111 (the script refuses those).
3. Reply with the temporary passcode and ask the student to change it on the account screen.

## Someone registered a student's email (squatter)
The real owner can't sign up because the email is taken.
1. `accounts delete 202312345@yu.edu.sa` lists the account without deleting it.
2. `accounts delete 202312345@yu.edu.sa --yes` deletes it. Its runs stay on the impact total,
   without a user, and its name is freed.
3. Tell the student to sign up again.

The same two steps handle a student who asks for their account to be deleted, though the phone's
account screen can do that itself.

## Pre-launch reset
Remove the anonymous test users from before accounts existed:
`accounts delete-anonymous` (lists them), then `accounts delete-anonymous --yes`.

## Deletion date: 12 months after launch
All student data is deleted 12 months after launch, unless Student Affairs approves keeping it
longer (write the approved date here when it exists).
1. `accounts delete-all` lists every account.
2. `accounts delete-all --yes` deletes them all. Profiles, student rows and participations go
   with them. Runs stay without a user, so the impact total doesn't change.
3. Check in the SQL editor: `select count(*) from public.students;` returns 0.

## Lists: colleges, majors, events
The college and major lists were checked against the university site on 28 Nov 2026 (Amr's
registrar check, `supabase/migrations/20261128120000_registrar_names.sql`). Codes never change;
only labels do.

These are data, so no deploy is needed. Run a change in the SQL editor, and add the same
statement to the repo as a new migration, so every project ends up with the same lists:
```sql
-- Correct a label
update public.majors set name_ar = '…' where code = 'BUS-MIS';
-- A new major (codes never change once used)
insert into public.majors (code, college_code, name_ar, name_en, sort) values ('ENG-XYZ', 'ENG', '…', '…', 5);
-- Retire a major: students keep it, new profiles can't pick it
update public.majors set active = false where code = 'ENG-XYZ';
-- The campaign's dates, donation rate and cap (read by the phone)
update public.events set starts_on = '2026-12-01', ends_on = '2027-01-31',
  impact_per_riyal = 100, riyal_cap = 1000 where active;
-- Retire a noun or adjective that reads badly: names already taken keep it, new ones can't pick it
update public.nicknames set active = false where id = 17;
```
