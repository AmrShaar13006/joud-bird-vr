# Joud Bird server (step 2)

Ranked phone runs are verified on the server: Supabase (Postgres plus Edge Functions). The server
issues every ranked round's seed and replays the submitted flaps with the same sim the phones
run. Practice and the VR pages never talk to it. The plan is in `prompts/06-mobile-step2.md`.

**Accounts (phase 3, from `20261127120000_accounts.sql`):** only students signed up with a YU
email and a passcode play ranked rounds. Guests never reach the server. The anonymous sign-in
described under "Phone side" below is what the phone still does until the accounts phone PR
lands; the server already refuses those sessions a ticket (`needsProfile`). Officer tasks:
`docs/accounts-runbook.md`.

## Projects
| | project | ref | region |
|---|---|---|---|
| staging | `joud-bird-staging` | `kuamwrkyrkqbklgoprha` | ap-south-1 (Mumbai) |
| production | `joud-bird` | not created yet | ap-south-1 |

- **Production:** blocked by the free plan's limit of 2 active projects per owner. Amr frees a slot
  (pause, delete or upgrade), then the same migrations and functions are applied there.
- **Region:** Supabase offers no Middle East region. Mumbai is one of the closest to Riyadh.
- **Auth settings** (dashboard, per project, done by Amr):
  - **Anonymous sign-ins:** off.
  - **Allow new users to sign up:** off. Accounts are made only by the `sign-up` function
    through the admin API, which this switch doesn't block (checked on staging, 28 Nov 2026).
  - **Confirm email:** off. No email is ever sent.
  - **Minimum password length:** 6 (passcodes are 6–12 digits).
  - **Sign-in rate limit:** raised only as far as about 20 phones signing in on one Wi-Fi need,
    since a higher limit also allows more passcode guesses per address.

## What we store, and why
| table | row | personal data |
|---|---|---|
| `auth.users` | a student: YU email, the passcode as a bcrypt hash (Supabase Auth) | the email, which holds the student ID |
| `students` | enrolment year (from the email), gender, college, major, Interlink; `complete` once all are set | yes |
| `participations` | one row per student per event: college, major and Interlink in that event | yes |
| `profiles` | the public name as ids: noun, adjective, 2-digit tag («وردة مشرقة 27»), renames today | none |
| `nicknames`, `adjectives` | the name lists; nouns marked masculine or feminine, `active` to retire one | none |
| `colleges`, `majors` | the profile lists as codes (BUS, BUS-ACC…) with Arabic and English labels | none |
| `events` | one row per campaign: dates, `impact_per_riyal` (100), `riyal_cap` (1,000), `active` | none |
| `run_tickets` | a server-issued seed per ranked round: ruleset, mode, seed, issued/expires/used times | none |
| `runs` | every submission, valid or not: flap ticks, end tick, the verified result, reason codes | none |

- **Not stored:** real names, IP addresses, device fingerprints, analytics, or free text. Winners
  give their full name on the club's prize form at the final.
- **Passcodes:** only Supabase Auth's bcrypt hash. Never in our tables, logs or code.
- **Delete an account** (`delete-account`, or an officer with `scripts/admin/accounts.ts`): the
  student row, participations, profile and tickets go; runs stay with `user_id` null, so the
  impact total never drops. The leaderboard skips runs without a user.
- **Deletion date:** all student data 12 months after launch, unless Student Affairs approves
  longer (`docs/accounts-runbook.md`).

## Access (row-level security)
| | public (anon key) | the student | named officers |
|---|---|---|---|
| public name, best score, rank | yes, through `get_leaderboard` | yes | yes |
| email | no | own (`get_me`) | dashboard, `winner_contacts` |
| college, major, Interlink, gender, enrolment year | no | own | dashboard |
| passcode | no | no | no |

- **Officers** are the people Amr adds to the Supabase organisation by name. Dashboard access is
  full access, so the list stays short. Phase 7 adds aggregate-only views.
- **Students** (the `authenticated` role, which old anonymous sessions also have):
  - read their own profile, student row, participations, tickets and runs
  - write nothing directly: the profile goes through `save_profile`, the name through `claim_name`
- **Public lists** (`nicknames`, `adjectives`, `colleges`, `majors`, `events`): readable by anyone.
- **Students never write tickets or runs.** Only the Edge Functions do, with the service role,
  through two `security definer` SQL functions:
  - `issue_ticket`: `needsProfile` unless the player has a complete student row and a name; then
    rate limits of 3 open tickets per player and 120 per hour, under a per-player advisory lock.
    It also writes the active event's participation row on the first ranked ticket.
  - `record_run`: consumes the ticket in the same transaction as the insert. A ticket that is
    already used turns the run into `ticketUsed`.

  `issue_ticket` and `record_run` can be executed by `service_role` only.
- **Public read functions** (the API is `/rest/v1/rpc/…`):
  - `get_leaderboard(mode, ruleset = 'mobile-1', limit = 20)`: rank, the public name (column
    `nickname`), best score and when it was reached. Only students with a complete profile and a
    name. Ties go to whoever got there first. Callable by anyone.
  - `get_impact_total()`: the sum of `impact` over valid runs, including deleted accounts' runs.
    Callable by anyone.
- **Student functions** (signed in; errors are raised with a reason code as the message, HTTP 400):
  - `save_profile(college, major, interlink, gender)`: the major must belong to the college and
    both must be active (`badProfile`). Also updates the active event's participation.
  - `claim_name(nickname_id, adjective_id, tag)`: the ids must be active and the tag 10–99
    (`badName`). A name someone holds fails on the unique index: **HTTP 409**. The first claim is
    free; then at most 5 changes a day, Riyadh time (`tooManyRenames`). Claiming your current
    name again is a no-op.
  - `get_me()`: email, enrolment year, profile, `profileComplete`, `name`, `renamesLeft`.
  - `get_my_best(mode, ruleset)`: your rank, best and name.
  - Without a student row (an old anonymous session): `needsAccount`.
- **Names are spelled only on the server** (`name_label`): noun, the adjective in the noun's form,
  the tag. The phone sends ids, never text. Every pair for review: `docs/name-pairs.txt`
  (`node scripts/run-ts.mjs scripts/print-name-pairs.ts`).
- **Service role only:** `sign_up_allowed()` (at most 30 new accounts a minute project-wide),
  `create_account(user, enrol_year)`, `winner_contacts(mode, ruleset, limit)`. Internal helpers
  `name_label` and `ranked_best` can't be called through the API at all.

  The Supabase security advisor flags the two public ones as "security definer functions callable
  by anon". That is intended: they expose only nicknames, scores and one total.

## Edge Functions
| function | auth | what |
|---|---|---|
| `sim-selftest` | anon JWT | Replays fixture files posted in the body. **Staging only**: replays cost CPU. |
| `sign-up` | none (deploy with **verify_jwt off**: a guest has no session) | `POST { email, passcode }` → a confirmed account and its student row, then the phone signs in with the same pair. 400 `badEmail` / `badYear` / `badPasscode` / `weakPasscode`, 409 `emailTaken`, 429 `tooMany`. If the student row fails, the new user is deleted again. |
| `delete-account` | player JWT | `POST {}` → deletes the caller's account (admin API). Runs stay without a user. |
| `issue-run` | player JWT | `POST { mode }` → a ticket: ruleset `mobile-1`, a uint32 seed from `crypto.getRandomValues`, 30 min to live. 403 `needsProfile` without a complete profile and a name; 429 (`tooManyOpen` / `tooManyPerHour`) past the limits. |
| `submit-run` | player JWT | `POST { ticketId, flaps, endTick, clientScore }` → the server's own result. |

- The functions use `supabase/functions/_shared/joud-sim.js`, the committed sim bundle from
  `npm run build:sim`, for every game rule. There is no second implementation.
- **Edge runtime determinism:** `npm run test:determinism` posts all 51 committed fixtures to
  `sim-selftest` when `SUPABASE_STAGING_URL` and `SUPABASE_STAGING_ANON_KEY` are set (for example
  in an untracked `.env.staging`).
- **Result, 24 Nov:** 51/51 PASS on `supabase-edge-runtime-1.79.1` (compatible with Deno 2.1.4,
  V8 11.6), an older V8 than the phones and Node.

### `submit-run` checks, in order (`_shared/submit.ts`)
1. **Ticket:** it exists, is this player's, is unused and not expired (`badTicket`, `ticketUsed`, `ticketExpired`).
   - An **identical retry** of a run already stored (same flaps and end tick) gets the stored answer
     again with `duplicate: true`, and nothing new is stored. That lets the phone's retry queue be safe.
2. **Log:** built from the ticket's ruleset, mode and seed plus the phone's flaps and end tick, then
   `validateLog` (step 1's reason codes).
3. **Replay:** it must end exactly at the claimed tick by `hit`, `floor`, `ceiling` or `maxTicks`;
   otherwise `endMismatch`.
4. **Wall clock:** `now − issued_at` must be at least the run's playing time minus 5 s (`tooFast`).
5. **Store:** the replay's score, flowers, impact, end reason and hash. `clientScore` is only compared
   (`scoreMismatch: true` in the reply).

Every rejection is stored with its reason, and the reply is 200 `{ valid: false, reason }`.
Malformed bodies get 400, a missing player 401, server errors 500 (the phone retries those).

**Sign-up rules** (`_shared/account-rules.ts`, no imports): the phone imports the same file, so
the browser and the server check the same thing.
- Email: trimmed, lower case, direction marks removed, Arabic-Indic digits made Latin, then
  `^(20\d{2})\d{5}@yu\.edu\.sa$` with the year from `MIN_ENROL_YEAR` (2022) to the current year
  in Riyadh.
- Passcode: the same digit normalization, 6–12 digits, not one repeated digit and not a straight
  run (123456, 987654). The phone must send the normalized passcode at every sign-in too.

**Tests:**
- `deno test --config supabase/functions/deno.json --allow-read=. supabase/functions` (17 tests,
  fake database and Auth, no network). Every playable `mobile-1` fixture verifies through
  `submit-run`, every rejection has its own test, and every sign-up outcome too. They also run
  as a row in `npm run test:determinism`.
- `src/mobile/account-rules.test.ts` (Vitest, in `npm test`): the email and passcode rules.
- SQL (`supabase/tests/`, 36 checks): the migrations on a throwaway local Postgres with a small
  Supabase stand-in. With `psql` pointed at an empty database:
  ```
  for f in supabase/tests/stub.sql supabase/migrations/20261124*.sql supabase/tests/legacy.sql \
           supabase/migrations/20261127*.sql supabase/tests/accounts.test.sql; do
    psql -X -q -v ON_ERROR_STOP=1 -f "$f" || break; done
  ```
  It ends with `ALL SQL CHECKS PASSED`.

**Live checks on staging, 24 Nov** (SQL with a temporary test user, then deleted):
- The 4th open ticket was refused.
- A reused ticket was stored as `ticketUsed`.
- The leaderboard showed «وردة 97»; `get_my_best` and `get_impact_total` were correct.
- Both functions answer 401 without a player token and 405 to GET.

## Phone side (`play/`, PR 7)
- **`src/mobile/net.ts`** is the only file that talks to the server.
  - It holds supabase-js 2.119.2 and loads lazily, after the first frame.
  - First load is unchanged at 199.7 kB gzip. The lazy server chunk is 58.9 kB, 259.3 kB in total.
  - `npm run check:mobile` proves supabase-js is not in the first load, and that `index.html` and
    `fallback.html` never load it.
- **Without config:** builds made without `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`
  drop the server code, and every round is practice.
- **Sign-in:** anonymous, on page load, kept by the SDK in localStorage (`joudbird.auth`).
- **Ticket pool** (`src/mobile/online.ts`, unit-tested):
  - Keeps one ticket ready per mode, so «العب» never waits on the network.
  - Refetches it on mode change, after each round and when the tab comes back.
  - Hands out a ticket only while a full 15-minute round still fits before it expires.
- **No ticket** (offline, signed out, rate-limited, anonymous sign-ins off): the round is practice,
  labelled «بدون اتصال: جولة تدريب». Never a ranked round on a phone-made seed.
- **Outbox:** at game over the run goes through the outbox.
  - The phone shows «جارٍ التحقق…», then «تم التحقق من النتيجة ✓» or «لم تُحتسب الجولة».
  - Offline, it shows «سنرسل نتيجتك عند الاتصال».
  - Queued runs (at most 5) are retried on load, when back online and when the tab returns, until
    their ticket expires. Identical retries are safe: `submit-run` answers with the stored result.
- **Nickname:**
  - The first ranked round asks for one of 24 fixed nicknames (`strings.ts`, same order as
    `public.nicknames`).
  - It can be changed from home («اسمك: …»).
  - If it can't be saved, the round starts anyway.
- **Leaderboard («المتصدرون»):** reached from home and game over.
  - Top 20 for the current mode, your rank and best, and «مجموع نقاط الأثر».
  - Cached for 60 s. Names are inserted as text, never HTML.
- **Autoplay** (`?debug=1&autoplay=1`) plays practice, except in a build made with `VITE_STAGING=1`.
- **E2E** (`tests/online.spec.ts`, manual, staging only):
  1. Build with `VITE_STAGING=1` and the staging `VITE_SUPABASE_*` values.
  2. Run `E2E_ONLINE=1 npx playwright test tests/online.spec.ts --project=chromium`.

  The autopilot plays one ranked round, and the server's verified score must equal the phone's.

## Deploying
- **Migrations:** they live in `supabase/migrations/` and are applied in filename order. Apply
  them with the Supabase connector (`apply_migration`), or with the Supabase CLI if Amr approves
  it. Never edit an applied migration; add a new one.
- **Functions:** deploy each folder in `supabase/functions/` together with `_shared/`.
- **Order for production:**
  1. migrations
  2. `issue-run`, `submit-run`, `delete-account` and `sign-up` (verify_jwt off), not `sim-selftest`
  3. the auth settings above
  4. Vercel env vars `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`
- Sign-up stays off in production until Student Affairs approves the data collection.
- **Smoke test (staging only):** `scripts/admin/smoke-accounts.mjs` (usage in its header) makes one
  throwaway account, walks it through sign-up, profile, name, a ranked run and the board, then
  deletes it. Its first two checks fail while open sign-ups or anonymous sign-ins are still on.
  Each run leaves one valid score-0 run with no user, which the board skips. Never run it against
  production, where it would make a real account.

## Abuse model
- **Prevented:**
  - **Edited scores, physics or results:** the server replays the flaps and stores its own result.
  - **A chosen or reused seed:** seeds come only from single-use tickets.
  - **Replaying an old run:** a ticket can be consumed once (`runs.ticket_id` is unique).
- **Limited:** a bot that actually plays a ranked run in real time.
  - A wall-clock check (PR 6) stops simulated-faster-than-real runs.
  - The rate limits slow down mass play.
  - The leaderboard is for fun, and the impact total is symbolic.
- **Accounts:**
  - **Guessing a passcode online:** 1,000,000 codes against Supabase's per-address sign-in limit.
    A winner must also hold the YU mailbox the club writes to.
  - **A database leak:** bcrypt on 6 digits falls quickly, so only the service role and named
    officers can read `auth.users`, and the sign-up screen warns against reusing a bank or phone PIN.
  - **Made-up student IDs:** possible, since no email is sent. The 30-a-minute cap limits volume;
    a fake can top the board but can't win, because nobody answers the club's email.
  - **A classmate's email registered first:** the student writes to the club and an officer
    deletes the squatter (`docs/accounts-runbook.md`).
- **Not used:** IP logs, device fingerprints, CAPTCHA (it would mean a third-party script).
