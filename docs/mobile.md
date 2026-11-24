# Joud Bird Mobile

The phone game (`play/`, from PR 2) and the VR pages share one deterministic core in `src/core`. A
run is fully described by **(ruleset id, mode, seed, flap ticks)**. In step 2 the server will
replay every submitted run to check it, so a replay must give the identical score in Chrome,
Safari, Node and Deno (the runtime of Supabase Edge Functions).

## Rulesets (`src/core/ruleset.ts`)
A `Ruleset` holds everything that affects a result: id, step, max ticks, the per-mode `Config`
(lane size and tuning), the points table, the mode multipliers, the course weights and the
obstacle-kind shapes.

| id | Used by | Step | Lane (sim metres) | Kinds |
|---|---|---|---|---|
| `vr-1` | `index.html`, `fallback.html` | 1/120 s | 2.8 × 1.6 | gates only, 1 point each (the 17 Nov booth game) |
| `mobile-1` | `play/` | 1/60 s | 1.0 × 1.8 (portrait) | all kinds below |

- **Never edit a ruleset in place.** Changing a value means a new id (`mobile-2`), new fixtures
  (`npm run fixtures`), and a note in `docs/decisions.md`. The fixture files store a hash of
  each ruleset's constants, and `determinism.test.ts` fails if they no longer match.
- VR URL tuning (`?g=&flap=&gap=…`) still works. Tuned VR rounds are not replayable as `vr-1`,
  and VR runs are never submitted.
- In mobile-1, the bird sits 0.35 right of the lane centre, so 0.85 of the lane is ahead of it.
  At a spacing of 0.34 that shows about 2.5 obstacles ahead (2.2 in easy).
- These are starting values. Their feel on real phones has not been checked yet.

### mobile-1 modes
| | easy | normal | hard |
|---|---|---|---|
| gravity / flap | −2.2 / 0.70 | −2.6 / 0.78 | −2.6 / 0.82 |
| gap (start → min) | 0.36 fixed | 0.29 → 0.22 | 0.25 → 0.19 |
| speed (start → max) | 0.30 fixed | 0.33 → 0.42 | 0.37 → 0.48 |
| floor / ceiling | soft (bounce) | end the round | end the round |
| kinds | gate, stairs, updraft, fork | all | all |
| impact multiplier | ×1 | ×2 | ×3 |

Speed and gap ramp with the number of obstacles **passed**, not with points (in vr-1 the two are equal).

## Obstacle kinds and points (mobile-1)
| kind | what | points |
|---|---|---|
| gate | one gap | 1 |
| stairs | 3 gates in a row whose gap centres step the same way by 0.1 | 2 each |
| updraft | a 0.2-long column in front of the gate that adds +1.2 m/s² upward | 2 |
| narrow | gap × 0.75 (at least 0.14) | 3 |
| moving | gap centre moves up and down linearly (ping-pong, ±0.08 at 0.1/s) | 3 |
| fork | two gaps split by a 0.08 block: the wide one is safe, the narrow one (× 0.62) is risky; which is on top is seeded | safe 1 / risky 5 |
| flower | a collectible in a gap (the risky gap of a fork; never on a moving gap) | +1 |

- Points are paid when the bird's centre passes the obstacle's trailing edge. A fork pays for the
  side of its middle block the bird is on at that moment.
- **Score** = obstacle points + flowers. **Impact points** = score × mode multiplier
  (`impactPoints(score, mode, ruleset)`).
- **Course:** a seeded sequence of kinds.
  - Weights ramp linearly from `start` to `end` over the first 40–50 obstacles.
  - After any kind worth 3 or more (narrow, moving, fork), the next obstacle is always a plain gate.
  - Neighbouring gaps stay within `maxGapShift` (0.16). A stairs run flips direction rather than
    break that rule.
- **No allocation after construction:** the pool's size is fixed. Fork, updraft, moving-gap and
  flower fields live on the pooled obstacles.

## Determinism rules (enforced by `src/core/determinism-guard.test.ts`)
- **Allowed in sim code:** JS doubles with `+ - * /`, comparisons, `%` on integer ticks,
  `Math.min/max/abs/floor/ceil/round/trunc/sign/sqrt`, `Math.imul` and bit operations. All of
  these give identical results in every engine.
- **Banned in `src/core`** (test files excepted):
  - `Math.sin cos tan asin acos atan atan2 sinh cosh tanh exp expm1 log log1p log2 log10 pow cbrt hypot`
  - `Math.random` and the `**` operator
  - `Date.now`, `new Date`, `performance`, `crypto`, timers

  These can differ between V8 and JavaScriptCore. `best.ts` takes a `Date` argument, which is fine.
- **Randomness:** `rng.ts` is mulberry32 and uses only `Math.imul` and `>>> 0`. The seed is a
  uint32. Shells make seeds with `crypto.getRandomValues` (`src/scene/seed.ts`) and pass them in.
- **Time:** only integer ticks.
  - The tick counter advances only in `playing` steps. Tick 0 is the flap that starts the round.
  - `advance()` and its accumulator only decide how many ticks run per frame, so frame timing
    never changes a result.
  - Live play and `replay()` both call `Game.step()`. There is no second code path.

## Run format (`src/core/run.ts`)
```ts
interface RunSpec   { rulesetId: string; mode: Mode; seed: number }   // seed: uint32
interface RunLog    extends RunSpec { flaps: number[] /* ascending ticks, no duplicates */; endTick: number }
interface RunResult { valid: boolean; reason?: string; score: number; obstaclePoints: number;
                      flowers: number; impact: number; endTick: number;
                      endReason: 'hit' | 'floor' | 'ceiling' | 'maxTicks' | 'logEnd';
                      hash: string; checkpoints: string[] }
function replay(log: RunLog, opts?: { maxTicks?: number }): RunResult
```
- **Recorder:** while playing, `Game` records the tick of each flap and drops a second flap in
  the same tick. At game over it sets `lastRun` and `lastResult`.
- **Hash:** 32-bit FNV-1a over the Float64 bits of the bird's y and vy, the counters, the RNG
  state and every obstacle field, in a fixed order. A checkpoint hash is stored every 600 ticks
  to show where two runs diverge.
- **Validation:** an invalid log returns `valid: false` with a reason, and `replay()` never
  throws. The reason codes are `badLog`, `unknownRuleset`, `badMode`, `badSeed`, `badEndTick`,
  `endTickTooLarge` (above 54,000 = 60 × 60 × 15 for mobile-1), `noFlaps`, `badFlap`,
  `unsortedFlaps`, `duplicateFlap`, `firstFlapNotZero` and `flapAfterEnd`.
- **End of the log:** a valid log replays until the round ends. If the bird is still flying when
  the log's `endTick` is reached, the result is `logEnd`. The server should compare `endTick`
  with the log's to confirm the run ended where the client said it did.

## Tests
| Command | What it proves |
|---|---|
| `npm test` | All Vitest suites: core rules (`core.test.ts`, unchanged), mobile rules, determinism guard, fixtures, live vs replay (500 seeds × 3 modes × 2 rulesets, random frame times 8–50 ms with hitches up to 300 ms, pauses, double taps), sim bundle up to date |
| `npm run fixtures` | **Only after a new ruleset id.** Plays the fixture runs through the live game (autopilot bot from `src/core/bot.ts` and random taps), checks live = replay and coverage (every kind, both fork sides, flowers), and writes `src/core/fixtures/*.json`, then the sim bundle |
| `npm run build:sim` | Builds `src/core/sim-entry.ts` (Vite library mode) into `supabase/functions/_shared/joud-sim.js`, a single ESM file with no imports, and copies the fixtures next to it. Commit both |
| `deno run scripts/determinism/deno-check.ts` | The committed bundle replays every fixture in Deno |
| `npm run test:determinism` | All of the above plus Chromium and WebKit (Playwright opens the built `check/` page), printed as one runtime × runs-passed table |
| `check/` (deployed) | Open it on a real phone: big PASS or FAIL with the user agent |

`supabase/functions/sim-selftest/` returns the same report as JSON from the Edge runtime. It is
not deployed in step 1.

Deno is a system tool, not an npm dependency:
- Windows: `winget install --id DenoLand.Deno`
- macOS/Linux: `curl -fsSL https://deno.land/install.sh | sh`

Playwright browsers: `npx playwright install chromium webkit`.
