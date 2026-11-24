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
| `issue-run` | player JWT | Issues a ticket (PR 6). |
| `submit-run` | player JWT | Verifies and stores a run (PR 6). |

- The functions use `supabase/functions/_shared/joud-sim.js`, the committed sim bundle from
  `npm run build:sim`, for every game rule. There is no second implementation.
- **Edge runtime determinism:** `npm run test:determinism` posts all 51 committed fixtures to
  `sim-selftest` when `SUPABASE_STAGING_URL` and `SUPABASE_STAGING_ANON_KEY` are set (for example
  in an untracked `.env.staging`).
- **Result, 24 Nov:** 51/51 PASS on `supabase-edge-runtime-1.79.1` (compatible with Deno 2.1.4,
  V8 11.6), an older V8 than the phones and Node.

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
