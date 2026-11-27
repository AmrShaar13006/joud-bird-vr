# Joud Bird server (step 2)

Ranked phone runs are verified on the server: Supabase (Postgres plus Edge Functions). The server
issues every ranked round's seed and replays the submitted flaps with the same sim the phones
run. Practice and the VR pages never talk to it. The plan is in `prompts/06-mobile-step2.md`.

## Projects
| | project | ref | region |
|---|---|---|---|
| staging | `joud-bird-staging` | `kuamwrkyrkqbklgoprha` | ap-south-1 (Mumbai) |
| production | `joud-bird` | not created yet | ap-south-1 |

- **Production:** blocked by the free plan's limit of 2 active projects per owner. Amr frees a slot
  (pause, delete or upgrade), then the same migrations and functions are applied there.
- **Region:** Supabase offers no Middle East region. Mumbai is one of the closest to Riyadh.
- **Auth settings** (dashboard, per project, done by Amr):
  - Enable **anonymous sign-ins**.
  - Raise the anonymous sign-in rate limit, which is 30 per hour per IP by default. Phones on
    one event Wi-Fi share an IP.

## What we store, and why
| table | row | personal data |
|---|---|---|
| `auth.users` | an anonymous user per phone (Supabase Auth) | none: no email, phone or name |
| `nicknames` | the fixed list of 24 Arabic nicknames | none |
| `profiles` | user id → nickname id plus a random 2-digit tag («وردة 27») | none |
| `run_tickets` | a server-issued seed per ranked round: ruleset, mode, seed, issued/expires/used times | none |
| `runs` | every submission, valid or not: flap ticks, end tick, the verified result, reason codes | none |

- **Not stored:** IP addresses, device fingerprints, analytics, or free text.
- **Delete:** deleting an anonymous user deletes their profile, tickets and runs (cascade).
- **Cleanup:** anonymous users aren't removed automatically. Delete old ones with the SQL in the
  Supabase docs ("Anonymous sign-ins → Automatic cleanup").

## Access (row-level security)
- **Players** (the `authenticated` role, which anonymous users also get):
  - read their own profile, tickets and runs
  - create their own profile
  - change only `profiles.nickname_id`
- **Players never write tickets or runs.** Only the Edge Functions do, with the service role,
  through two `security definer` SQL functions:
  - `issue_ticket`: rate limits of 3 open tickets per player and 120 per hour, under a per-player
    advisory lock.
  - `record_run`: consumes the ticket in the same transaction as the insert. A ticket that is
    already used turns the run into `ticketUsed`.

  `issue_ticket` and `record_run` can be executed by `service_role` only.
- **Public read functions** (the API is `/rest/v1/rpc/…`):
  - `get_leaderboard(mode, ruleset = 'mobile-1', limit = 20)`: rank, «nickname tag», best score
    and when it was reached. Ties go to whoever got there first. Callable by anyone.
  - `get_impact_total()`: the sum of `impact` over valid runs. Callable by anyone.
  - `get_my_best(mode, ruleset)`: your rank and best. Signed-in players only.

  The Supabase security advisor flags the two public ones as "security definer functions callable
  by anon". That is intended: they expose only nicknames, scores and one total.

## Edge Functions
| function | auth | what |
|---|---|---|
| `sim-selftest` | anon JWT | Replays fixture files posted in the body. **Staging only**: replays cost CPU. |
| `issue-run` | player JWT | `POST { mode }` → a ticket: ruleset `mobile-1`, a uint32 seed from `crypto.getRandomValues`, 30 min to live. Returns 429 (`tooManyOpen` / `tooManyPerHour`) past the limits. |
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

**Tests:** `deno test --config supabase/functions/deno.json --allow-read=. supabase/functions` (11
tests, fake database, no network). Every playable `mobile-1` fixture verifies through
`submit-run`, and every rejection has its own test. They also run as a row in
`npm run test:determinism`.

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
  2. `issue-run` and `submit-run` (not `sim-selftest`)
  3. the auth settings above
  4. Vercel env vars `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`

## Abuse model
- **Prevented:**
  - **Edited scores, physics or results:** the server replays the flaps and stores its own result.
  - **A chosen or reused seed:** seeds come only from single-use tickets.
  - **Replaying an old run:** a ticket can be consumed once (`runs.ticket_id` is unique).
- **Limited:** a bot that actually plays a ranked run in real time.
  - A wall-clock check (PR 6) stops simulated-faster-than-real runs.
  - The rate limits slow down mass play.
  - The leaderboard is for fun, and the impact total is symbolic.
- **Not used:** IP logs, device fingerprints, CAPTCHA (it would mean a third-party script).
