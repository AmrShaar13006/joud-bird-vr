# Task: Joud Bird Mobile, step 2: verified runs, server seeds and the leaderboard

Public launch is **Sat 28 Nov 2026** (Fri 27 if testing finishes early); Joud's initiative ends Mon
30 Nov. This step must be done by **Thu 26 Nov, 23:00 Riyadh**, so Friday is left for phone testing.

Step 1 (PRs #1–#4) must be merged into `main` first. Branch from `main`.

Read first: CLAUDE.md, docs/mobile.md (run format, replay, determinism rules), docs/decisions.md,
`src/core/replay.ts`, `src/core/run.ts`, `src/mobile/run-spec.ts`, `src/mobile/main.ts`,
`supabase/functions/`.

## Decisions (accepted by Amr, Tue 24 Nov 2026)
1. **Sign-in:** **anonymous Supabase sign-in** with a nickname picked from a fixed Arabic list (no
   email, phone or free text, so no personal data and nothing to moderate).
2. **Dependencies:** `@supabase/supabase-js` **2.119.2** exactly (`--save-exact`; the same version
   via `npm:@supabase/supabase-js@2.119.2` in the Edge Functions). Nothing else.
   - The Supabase CLI is **not** approved by default. Use the Supabase MCP tools to apply
     migrations and deploy functions.
   - If they aren't connected, stop and ask.
3. **Projects:** two Supabase projects in Amr's organization, in `ap-south-1` (Mumbai; Supabase
   offers no Middle East region):
   - `joud-bird-staging`: created by Claude through the Supabase connector at Amr's request,
     free plan, $0.
   - `joud-bird` (production): blocked by the free plan's limit of 2 active projects. Amr pauses,
     deletes or upgrades a project to free a slot; Claude never does that.
   - Amr enables **anonymous sign-ins** in each project's Auth settings and raises its per-IP rate
     limit (30 per hour by default; event Wi-Fi puts many phones behind one IP).
4. **Leaderboard:** all-time, per mode, top 20, nickname and score only, plus the campaign's total
   impact points («نقاط الأثر»).
   - Any real-world meaning of the total ("each N points = …") comes from Joud. Never invent one.
5. **Difficulty:** any retune must happen **before** ranked runs go live, as a new `mobile-2`
   ruleset. Once runs are stored, a ruleset never changes.

## Goal
A ranked run counts only if the server replays it and gets the same result:
- The server issues the seed (a single-use **ticket**).
- The phone submits only `(ticketId, flaps, endTick)`.
- The Edge Function replays it with the committed sim bundle and stores the verified score.

Practice stays fully offline and is never sent. The VR pages are unchanged and never call the
server.

Hard rules:
- `src/core` does not change. If a rule must change, use a new ruleset id plus fixtures (CLAUDE.md).
- The Edge Functions import only `supabase/functions/_shared/joud-sim.js` for game logic. There is
  no second implementation.
- **Never trust the client** for ruleset, mode, seed, score, impact, flowers or end reason. All of
  them come from the ticket and the replay.
- **Secrets:**
  - The anon key and project URL are public and go in Vercel env vars `VITE_SUPABASE_URL` and
    `VITE_SUPABASE_ANON_KEY`.
  - The service-role key lives only in the Edge Function secrets.
  - Never commit keys or `.env`.
- **Privacy:** collect no personal data. No analytics, no third-party scripts, no IP logging in
  tables.

## Work order: three stacked branches, one PR each
1. `feat/server-schema`: migrations, RLS and views; deploy `sim-selftest` to staging.
2. `feat/server-functions`: the `issue-run` and `submit-run` Edge Functions, with Deno tests.
3. `feat/mobile-online`: sign-in, ticket prefetch, submit with retry, leaderboard and impact UI.

Stop and report if `sim-selftest` on the real Edge runtime is not 51/51 PASS. Nothing ranked goes
live until it is.

---

## PR 5: feat/server-schema
- Commit SQL migrations under `supabase/migrations/`. Apply them to **staging** only until Amr says
  production.
- **Tables:**
  - `profiles(id uuid pk = auth.uid(), nickname text not null, created_at)`. The nickname must be
    one of the fixed list, enforced by a check constraint or a lookup table.
  - `run_tickets(id uuid pk, user_id, ruleset_id, mode, seed bigint, issued_at, expires_at, used_at)`.
    The seed is a uint32 drawn on the server with `crypto.getRandomValues`.
  - `runs(id, ticket_id unique, user_id, ruleset_id, mode, seed, flaps int[], end_tick, valid,
    reason, score, obstacle_points, flowers, impact, end_reason, hash, submitted_at)`.
    - `ticket_id unique` means a ticket can be used only once.
    - Store rejected runs too (`valid = false`, `reason`), so cheating attempts are visible.
- **Views** (rank ties go to whoever reached the score first):
  - `leaderboard(mode, nickname, best_score, achieved_at)`: best valid run per user per mode.
  - `impact_total(total)`: sum of `impact` over valid runs.
- **RLS:**
  - Users read and update only their own profile, and read their own runs and tickets.
  - Everyone (anon included) reads the two views.
  - Nobody inserts into `run_tickets` or `runs` directly; only the Edge Functions do (service role).
- **Self-test:** deploy `sim-selftest` to staging and paste its JSON. It must show 51/51 PASS with the
  Deno and V8 versions.
- **Docs:** `docs/server.md` with the schema, RLS, a data list ("what we store and why") and how to
  apply migrations.

## PR 6: feat/server-functions
Both functions require a signed-in user (JWT). Keep the handler logic in pure functions with the
database passed in, so Deno tests can call them with a fake.

### `issue-run`: POST `{ mode }` → `{ ticketId, rulesetId, mode, seed, expiresAt }`
- `rulesetId` is the current ranked ruleset, a server constant (`mobile-1` unless decision 5
  changes it).
- `expires_at = issued_at + 15 min` (the longest possible run, 54,000 ticks at 60 Hz) `+ 15 min`
  (time for an offline retry).
- **Rate limits:**
  - At most 3 open (unused, unexpired) tickets per user. The client prefetches one, so 3 is enough.
  - At most 120 tickets per user per hour.
  - Beyond either, return 429.

### `submit-run`: POST `{ ticketId, flaps, endTick, clientScore }` → the stored result
Check in this order. Every rejection is stored with its reason code, and the function never throws.
1. **Ticket:** it exists, belongs to this user, is unused and not expired (`badTicket`,
   `ticketUsed`, `ticketExpired`). Mark it used in the same transaction as the insert.
2. **Log:** build the `RunLog` from the **ticket's** ruleset, mode and seed plus the client's
   `flaps` and `endTick`, then run `validateLog` (it returns step 1's reason codes).
3. **Replay:** run `replay(log)` from the bundle.
   - The result must end exactly at the log's `endTick` with `hit`, `floor`, `ceiling` or
     `maxTicks`. A `logEnd` or a different end tick is `endMismatch`.
4. **Wall clock:** `submitted_at − issued_at` must be at least the run's real length (`endTick / 60`
   s) minus 5 s. A shorter gap means the run was simulated, not played (`tooFast`).
5. **Store** the replay's score, flowers, impact, end reason and hash.
   `clientScore` is only compared and logged (`scoreMismatch` is a warning, not a rejection).

### Tests (Deno, `deno test`)
- **Happy path:** the committed `mobile-1` fixtures replay to their stored scores through
  `submit-run` with a fake database.
- **Rejections, one test each:**
  - wrong user, reused ticket, expired ticket
  - each `validateLog` reason
  - end mismatch, too fast
  - a seed or mode in the body is ignored (the ticket wins)
- **Rate limits:** the 4th open ticket and the 121st per hour are refused.
- **`npm run test:determinism`:** gains a row for the Edge Function test run. Keep the table
  output.

Deploy both functions to staging. Then post one real run to staging with `curl` and paste the JSON
response. Take the run from `window.__joudRuns` after a played round, or from the fixtures.

## PR 7: feat/mobile-online
- **Supabase client** (`src/mobile/net.ts`), the only file that talks to the server.
  - Lazy-loaded the first time a ranked round is wanted, so practice and first paint stay fast and
    offline.
  - Anonymous sign-in, with the session kept by the SDK in localStorage.
  - Report the `play/` gzip delta. Keep `play/` JS+CSS under 250 kB gzip.
- **Nickname:** on the first ranked run, the player picks from about 24 Arabic nicknames, drawn from
  Joud's world (flowers, birds, sparkles). The list is in `strings.ts` and has no real names. It can
  be changed later on the home screen.
- **Seeds:** `getRunSpec()` becomes the ticket path.
  - **Prefetch:** keep one ticket ready (fetched on the home screen and right after game over), so
    pressing «العب» never waits on the network.
  - **No ticket:** offline or failed. Show «بدون اتصال: جولة تدريب» and start a practice round. Never
    a ranked round with a client seed.
  - **Mode change:** a ticket is per mode, so changing mode refetches it.
- **Submit at game over:**
  - Send `lastRun` and show the server's verified score as final.
  - While sending, show «جارٍ التحقق…».
  - **On network failure:** queue the run in localStorage (at most 5) and retry on the next launch
    and when back online, until the ticket expires.
  - **On rejection:** show a neutral «لم تُحتسب الجولة» with no blame, and log the reason with
    `?debug=1`.
- **Best score:** the server's best is the truth when online. localStorage stays as the offline
  copy.
- **Leaderboard screen:** «المتصدرون», reached from home and game over.
  - Top 20 per mode, plus your own rank and best.
  - The campaign's impact total («مجموع نقاط الأثر»).
  - Cached for 60 s, read-only, and RTL with Latin digits (like the HUD).
- **VR pages:** they never load `net.ts`. `npm run check:mobile` still passes. Extend it to prove
  `index.html` and `fallback.html` don't include `@supabase`.
- **E2E:** a Playwright test against **staging**, skipped without `SUPABASE_STAGING_URL`.
  - The autoplay bot plays one ranked round.
    - Autoplay may play ranked only in a build made with `VITE_STAGING=1`.
    - Production builds always force autoplay to practice. Add a test that proves it.
  - The run is verified, it appears on the leaderboard, and its server score equals the local
    replay.
  - Clean up the test user afterwards.

## Abuse model (write it into docs/server.md)
- **Cheating that is impossible:** the replay stops edited scores, seeds the player chose, edited
  physics and reused runs.
- **Cheating that is still possible:** a bot that actually plays a run in real time. The wall-clock
  check and rate limits slow it down; the leaderboard is for fun and the impact total is symbolic.
- **No IP logs, no device fingerprinting.**

## The VR build must keep working
- The VR pages make no network calls and their behaviour is unchanged.
- `npm test`, `npm run build` and `npm run test:determinism` pass. Play one round on `index.html`
  and one on `fallback.html`.

## Done means
- `npm run typecheck`, `npm test`, `npm run build`, `npm run check:mobile`,
  `npm run test:determinism` (with the new Edge row) and `deno test` all pass.
- `sim-selftest` and both functions are deployed to staging, with the curl and E2E outputs pasted.
- Production is deployed only after Amr says so: the same migrations and functions, plus the Vercel
  env vars.
- End the report with:
  - **Verified by me:** tests, staging deploys, an E2E ranked run, a rejected forged run (edited
    score and reused ticket), offline practice, the retry queue, and VR untouched.
  - **A human must still check:**
    - A ranked run on a real iPhone and an Android over mobile data.
    - What happens when the signal drops mid-run.
    - Nickname picker and leaderboard legibility.
    - Joud's OK on the impact-total wording.
    - That the production keys are set in Vercel.
