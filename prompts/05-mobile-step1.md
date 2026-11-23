# Task: Joud Bird Mobile, step 1: deterministic core and mobile shell

Joud's initiative ends Mon 30 Nov 2026. Public launch is Sat 28 Nov (Fri 27 if testing finishes early). This step must be done by
**Tue 24 Nov, 23:00 Riyadh**. Server work (Supabase sign-in, tables, Edge Functions) is step 2. Do NOT
start it here.

The feature freeze in CLAUDE.md belonged to the 17 Nov event and is over. New work on `feat/*` branches
is allowed again. Every other rule in CLAUDE.md still applies: merge commits only, small PRs, no new
dependencies beyond the ones listed below, no Flappy Bird names or art, Joud's look only from
`docs/joud-brief.json` and `docs/references/`, and `public/models/joud.glb` stays untouched.

Read first: CLAUDE.md, docs/spec.md, docs/decisions.md, docs/testing.md, docs/joud-brief.json,
docs/joud-brand.md, and everything in src/core/.

## Goal
Add a third page, `play/index.html` → `src/mobile/main.ts`. It is a portrait, one-tap phone game in the
mobile browser, with no WebXR and no IWSDK, running on the same `src/core`. The VR pages (`index.html`,
`fallback.html`) must keep behaving exactly as they do today.

The deciding requirement: a run is fully described by (ruleset id, mode, seed, flap ticks). Replaying it
must give the identical score in Chrome, Safari, Node and Deno (the runtime of Supabase Edge Functions).
The server will re-run every submitted run to verify it. Everything else depends on this.

## Pre-approved dependencies (nothing else)
- `@playwright/test` as a devDependency, with the Chromium and WebKit browsers.
- Deno installed on the machine (a system tool, not an npm dependency). If it is missing, print the
  install command, skip only the Deno step, and say so in the report. Do not work around it.
- No Supabase SDK in this step.

## Work order: three stacked branches, one PR each
1. `feat/mobile-core`: seeded RNG, rulesets, obstacle kinds and points, replay, determinism tests.
   **Highest priority.** If the determinism test fails in WebKit and you cannot fix it, stop and report.
   Otherwise continue.
2. `feat/mobile-shell`: the portrait phone page.
3. `feat/mobile-perf`: performance tiers and practice mode.
Each PR may be larger than the usual 300-line target. Keep each one focused.

---

## PR 1: feat/mobile-core

### Determinism rules (enforced by a test)
- Simulation numbers are JS doubles. Use only `+ - * /`, comparisons, `Math.min/max/abs/floor/ceil/round/
  trunc/sign/sqrt`, `Math.imul` and bit operations. These give identical results in every engine.
- Banned in src/core (except in test files): `Math.sin cos tan asin acos atan atan2 sinh cosh tanh exp
  expm1 log log1p log2 log10 pow cbrt hypot`, `Math.random`, the `**` operator, `Date.now`, `new Date`,
  `performance`, `crypto`, timers. These can differ between V8 (Chrome, Node, Deno) and
  JavaScriptCore (Safari) and make the server disagree with iPhones.
- Add `src/core/determinism-guard.test.ts`. It scans the non-test files in src/core and fails on any
  banned token. `best.ts` takes a `Date` argument, which is allowed; only constructing one or reading
  the clock is banned.
- Moving gaps use a linear ping-pong (triangle wave), never `sin`.
- Time exists only as integer ticks. The tick counter advances only in `playing` steps. Tick 0 is the
  flap that starts the round. Frame timing must never change a result: `advance()` and its
  accumulator only decide how many ticks run per frame.

### Seeded RNG
- `src/core/rng.ts`: mulberry32 (or sfc32), using only `Math.imul` and `>>> 0`, returning
  `u32 / 4294967296`. Seed is a uint32.
- `Game` no longer defaults to `Math.random`. It takes a seed. The VR shells (`src/systems`,
  `src/fallback`) create a seed with `crypto.getRandomValues` in shell code and pass it in.

### Rulesets
- A `Ruleset` holds everything that affects a result: id, step, lane size, per-mode tuning, the
  points table, mode multipliers, and pattern weights.
- `vr-1` reproduces today's VR behaviour: plain gaps only, 1 point each, step 1/120, today's
  `CFG`/`PRESETS`. The existing `configFor`/`parseUrl` behaviour for VR stays the same.
- `mobile-1`: step **1/60**, a portrait lane (start around 1.0 wide × 1.8 tall in sim metres, and tune
  it so about 2.5 obstacles are visible ahead), and its own easy/normal/hard tuning. Easy keeps soft
  floor and ceiling, as in VR.
- The fixture file stores the ruleset id and a hash of the ruleset's constants. A test fails if the
  constants change without a new id. Changing rules means a new id plus regenerated fixtures,
  never a silent edit.

### Obstacle kinds and points (mobile-1): one table in the ruleset
| kind    | what                                                                    | points          |
|---------|-------------------------------------------------------------------------|-----------------|
| gate    | one gap                                                                 | 1               |
| stairs  | 3 gates in a row whose gap centres step the same direction by a fixed amount | 2 each     |
| updraft | a column region that adds upward acceleration, followed by a gate       | 2               |
| narrow  | a gap clearly smaller than the normal gap at this score                 | 3               |
| moving  | the gap centre moves up and down linearly (ping-pong)                   | 3               |
| fork    | two gaps stacked, split by a block: wide = safe, narrow = risky; which side is seeded | safe 1 / risky 5 |
| flower  | a collectible inside or next to a gap (circle overlap)                  | +1              |
- Points are awarded when the bird's centre passes the obstacle's trailing edge, as today. A fork
  pays according to which gap the bird went through.
- A course is a seeded sequence of patterns, weighted by mode and by distance (difficulty ramp).
  - Easy: gate, stairs, updraft and fork only, with no moving gaps.
  - Normal and hard: every kind.
  - Never place two kinds worth 3 or more back to back without a gate between them.
  - Keep the `maxGapShift` reachability rule.
- Score = obstacle points + flowers. Impact points = score × mode multiplier (easy 1, normal 2,
  hard 3). Export `impactPoints(score, mode, ruleset)`.
- No allocation after construction: give forks and flowers fixed pools.

### Replay API: pure, used live on the phone and later inside the Edge Function
    interface RunSpec   { rulesetId: string; mode: Mode; seed: number }
    interface RunLog    extends RunSpec { flaps: number[] /* ascending ticks, no duplicates */; endTick: number }
    interface RunResult { valid: boolean; reason?: string; score: number; obstaclePoints: number;
                          flowers: number; impact: number; endTick: number;
                          endReason: 'hit' | 'floor' | 'ceiling' | 'maxTicks' | 'logEnd';
                          hash: string; checkpoints: string[] }
    function replay(log: RunLog, opts?: { maxTicks?: number }): RunResult
- Hash: 32-bit FNV-1a over the Float64 bits (via DataView) of the bird's y and vy, every obstacle
  field and the counters, in a fixed order. Add a checkpoint hash every 600 ticks so a divergence
  can be located.
- Validation returns `valid: false` with a reason code and never throws. Cases: unknown ruleset,
  unsorted or duplicate flaps, a flap after the end tick, or `endTick` above `MAX_TICKS`
  (60 × 60 × 15).
- Recorder: while playing, the live `Game` records the tick of each flap and drops duplicates within
  one tick. At game over it exposes `lastRun: RunLog` and `lastResult: RunResult`. Live play and
  replay call the **same** step function. There is no second code path.

### Determinism test
1. `npm run fixtures` (run only on purpose) runs `scripts/gen-fixtures.ts`, which writes
   `src/core/fixtures/mobile-1.json` and `vr-1.json`.
   - mobile-1: at least 30 runs across all three modes. Include long autopilot-bot runs and
     random-tap runs.
   - Across the set, every obstacle kind, both fork sides and flowers must appear. Assert this.
   - Each run stores its expected `RunResult`.
2. Node: Vitest checks every fixture.
3. Live versus replay: drive `Game` through `advance()` with random frame times (8–50 ms, plus
   hitches up to 300 ms) and taps between frames. `lastRun` must replay to an identical result.
   Run 500 seeds per mode.
4. Sim bundle: `npm run build:sim` builds `src/core/sim-entry.ts` with Vite library mode (no new
   dependency) into `supabase/functions/_shared/joud-sim.js`, a single ESM file with no imports.
   Commit it. A test fails if it is out of date. Deno cannot import src/core directly, because the
   imports there have no file extensions.
5. Deno: `scripts/determinism/deno-check.ts` imports that bundle and the fixtures, then prints
   PASS/FAIL for each run and sets the exit code. Also add
   `supabase/functions/sim-selftest/index.ts`, which returns the same report as JSON. Do not deploy
   it in this step.
6. Browsers: a `check/index.html` page runs every fixture and shows a large PASS/FAIL with the user
   agent. Ship it in the production build so it can be opened on real phones on 26–27 Nov. A
   Playwright test opens it in Chromium and WebKit and asserts PASS.
7. `npm run test:determinism` runs steps 2 and 4 (up-to-date check), then 5 and 6, and prints one
   table: runtime × runs passed.

---

## PR 2: feat/mobile-shell
- Pages and imports:
  - Add `play/index.html` as a Vite input next to `main` and `fallback`. Code goes in `src/mobile/`.
  - Use plain `three` (the same super-three). Never import `@iwsdk/*`, and use no WebXR.
  - Prove from the build output that the mobile chunk graph contains no IWSDK code. Report its
    gzipped size.
  - Check that the IWER emulator is not injected into the production mobile page.
- Reuse `src/scene` where it fits: `bird.ts` with joud.glb (glasses and legs from code, as today),
  scenery flowers, audio, strings, and brand colours from docs/joud-brand.md. Invent nothing about
  Joud.
- Portrait:
  - The canvas fills a portrait frame, respecting safe-area insets.
  - On a phone in landscape, show «لف جوالك» and pause automatically.
  - On desktop, centre the portrait frame.
- Input:
  - `pointerdown` anywhere on the play area is a flap. Space or ArrowUp flaps on desktop. All input
    goes through the `InputBus`.
  - Use `touch-action: none` and block double-tap zoom, text selection, the long-press menu,
    pull-to-refresh and overscroll.
- UI as DOM (Arabic, RTL, Latin digits). Canvas-texture text is a VR rule only.
  - Home: mode picker «سهل ×1 / عادي ×2 / صعب ×3» and a practice toggle «تدريب».
  - Play: score HUD and pause.
  - Game over: score, flowers, impact points («نقاط الأثر»), and play again.
  - Keep strings in one file.
- Loop:
  - Each `requestAnimationFrame`: drain the bus, then `game.advance(dt)`.
  - Render by interpolating between the previous and current sim state. This is render-only, so
    90 and 120 Hz screens stay smooth.
  - Call `game.suspend()` on `visibilitychange` (hidden) and on `blur`.
  - Unlock audio on the first tap (iOS).
- Seed and runs:
  - The client makes the seed with `crypto` for now. Wrap it in one function, `getRunSpec(mode)`,
    so step 2 can switch to a server-issued seed in one place.
  - Practice runs carry `practice: true` and will never be submitted.
  - With `?debug=1`, log each ranked `RunLog` and result to the console and keep the last 5 in memory.
- No network calls. After the first load the page must work offline.

## PR 3: feat/mobile-perf
- Tiers:
  - Choose low, medium or high at start from `hardwareConcurrency`, `deviceMemory`, screen size and
    DPR.
  - A frame-time watchdog drops one tier if the average frame exceeds 20 ms for 3 s. It never steps
    up during a run.
  - Tiers change rendering only: pixel-ratio cap (1 / 1.5 / 2), antialias, effects, scenery density
    and bird detail. The sim stays the same.
  - `?tier=` overrides the choice. The debug HUD shows the tier.
- Budget, same as VR: under 50 draw calls, no shadows, no post-processing, Lambert/Basic materials.
- Practice mode: same ruleset, random seed, clearly labelled, and never submitted.

---

## The VR build must keep working
- The existing `src/core/core.test.ts` passes. If an API change forces edits, keep what each
  assertion means.
- `vr-1` fixtures pass. Today's VR gameplay is unchanged.
- `npm run build` still emits `index.html` and `fallback.html`. Play one round on desktop in each.

## Docs
- `docs/mobile.md`: rulesets, the run format, the determinism rules, the obstacle and points table,
  and how to run every test.
- CLAUDE.md: add a short "Mobile (play/)" section covering the target (portrait phones in mobile
  Chrome and Safari), the determinism rules, and a note that the Quest rules apply to the VR pages.
  Mark the freeze note as historical.
- `docs/decisions.md`: record the ruleset ids, the 60 Hz mobile step, doubles with banned functions
  instead of fixed point, and the sim-bundle approach.

## Done means
- `npm run typecheck`, `npm test`, `npm run build` and `npm run test:determinism` all pass. Paste
  the runtime × pass table.
- End the report with:
  - **Verified by me**: tests, Chromium, WebKit, Node, Deno, desktop play of all three pages.
  - **A human must still check**:
    - `check/` on a real iPhone (Safari) and two Androids (old and recent)
    - tap feel and latency
    - readability in sunlight
    - fps and heat on the old Android
    - landscape behaviour
    - one VR round on the Quest
