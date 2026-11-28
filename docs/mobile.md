# Joud Bird Mobile

The phone game (`play/`, from PR 2) and the VR pages share one deterministic core in `src/core`. A
run is fully described by **(ruleset id, mode, seed, flap ticks)**. In step 2 the server will
replay every submitted run to check it, so a replay must give the identical score in Chrome,
Safari, Node and Deno (the runtime of Supabase Edge Functions).

## The phone page (`play/index.html` → `src/mobile/`)
- **Code:** plain `three` (the same super-three as the VR pages), no `@iwsdk/*`, no WebXR.
  `npm run check:mobile`, run after a build, proves that the `play/` chunk graph has no IWSDK,
  uikit or IWER modules and that no emulator is injected. It also prints the gzipped size.
- **Reused from `src/scene`:** `Bird` (joud.glb with code-built glasses and legs), the flower
  strip, the brand colours, `Sfx` and `randomSeed`.
- **Files:** `view.ts` draws the lane with an orthographic camera. `ui.ts` holds the DOM screens.
  Every string is in `strings.ts`.
- **Layout:**
  - On a phone the canvas fills the screen, and the HUD respects the safe-area insets.
  - On desktop the page shows a centred 9:16 frame.
  - A phone held sideways shows «لف جوالك» and pauses.
- **Input:**
  - `pointerdown` on the play area, or Space/ArrowUp, sends `flap`. Esc/P pauses, Enter starts.
    Everything goes through the `InputBus`.
  - `touch-action: none`, and no selection, long-press menu, double-tap zoom, pull-to-refresh
    or overscroll.
- **Loop:**
  - Each `requestAnimationFrame` drains the bus, then calls `game.advance(dt)`.
  - The view interpolates between the state before the last step (`game.beforeStep` →
    `view.snapshot`) and the current one, using `game.alpha`. This is render-only, so 90 and
    120 Hz screens stay smooth.
  - `visibilitychange` (hidden), `blur` and `pagehide` call `game.suspend()`.
  - Audio unlocks on the first tap.
- **Seeds:** `getRunSpec(mode, practice, ticket)` in `run-spec.ts` is the only place a round's seed
  is chosen.
  - Ranked rounds use a server ticket (step 2, `docs/server.md`).
  - Practice uses crypto.
  - A ranked request without a ticket plays as practice («بدون اتصال: جولة تدريب»).
  - Practice runs carry `practice: true` and are never submitted.
- **Debug:** `?debug=1` logs each ranked `RunLog` and result to the console, keeps the last 5 in
  `window.__joudRuns`, and shows fps, draw calls, state, tick and seed. It also puts the game on
  `window.__joudGame` for screenshot scripts. Adding `&autoplay=1` makes the core autopilot
  (`src/core/bot.ts`, one decision per fixed step) fly practice rounds, which are never ranked.
  `&birdScale=1.15` (0.5 to 2) draws the bird bigger or smaller for size tests: only the drawn
  model (`birdHolder` in `view.ts`), never the hitbox, which stays the ruleset's `birdRadius`.
- **Rig prototype:** `?debug=1&rig=1` (without `&model=`) shows Joud's 4-bone rig (`src/scene/bird-rig.ts`, weights
  in `src/scene/rig-weights.ts`) large on a plain background instead of the game, with buttons
  for wing poses, views and the two shoulder blends. `src/mobile/rig-gate.ts` loads
  `rig-view.ts` as its own lazy chunk and stops the game from starting there. `npm run build &&
  npm run rig:shots` saves the review screenshots to `docs/screens/rig/`. Not used in the game yet.
- **Other flags:** `?mode=`, `?mute=1`, `?model=placeholder`, `?fx=0`. URL tuning (`?g=` etc.) is
  ignored here, because ranked rules only come from the ruleset.
- **Model viewer:** `?debug=1&rig=1&model=v2` (or `v1`) replaces the game with a viewer for
  `public/models/joud-v2.glb`. `src/mobile/model-gate.ts` stops the game from starting there;
  `main.ts` imports it before `rig-gate.ts`, so `&model=` wins over the rig prototype.
  - Stills (folded, spread) and the five clips inside the GLB: `idle`, `flap`, `glide`, `fall`,
    `crash` (24 fps; no clip keys the root bone, which the game moves and tilts).
  - **Tap** plays them the way the game will, on the game's own physics (`mobile-1`): a tap plays
    `flap` (0.08 s cross-fade), which ends on `glide`; `fall` starts once the bird sinks faster
    than 65 % of its terminal speed; the floor or the roof plays `crash`. A tap during `flap`
    restarts it with a 0.05 s cross-fade, and taps under 0.3 s apart play it at up to 1.6x.
  - Views: front, three-quarter, side, back, face, top, and the game view (the bird turned −55°,
    as `src/scene/bird.ts` draws it). Also the official art beside the model, sockets, blink,
    the toon look proposal, and `&status=1` (a caption of what is playing, for recordings).
  - **Presentation tilt:** in the game view the bird leans 14° towards the camera
    (`PRESENT_TILT`; the `tilt` button or `&tilt=0` turns it off), so the tops of the wings show
    in a glide although the camera is level. The lean is on a wrapper above the root that turns
    about the root's own place: the root's position and tilt stay the game's. When v2 goes into
    the game, `src/scene/bird.ts` needs the same wrapper.
  - **Game view tests:** `&bg=game` puts the game's own sky, plaza and ground behind the bird
    (`src/mobile/game-backdrop.ts`, the code `view.ts` draws the game with) and uses the game
    camera's fixed frame, so a 390 × 844 window is a phone's screen. The viewer's chunk cannot
    import from the `play/` entry's chunk, which `model-gate.ts` leaves in an error state, so the
    gate imports `game-backdrop.ts` and hands it over. With it: `&birdScale=` (the drawn bird
    only, as in the game), `&turn=` (degrees; `bird.ts` uses −55) and `&laneY=` (stills and single
    clips, lane units), `&scroll=` (the backdrop as after that many lane units of play; 0 is
    where it stays with effects off), and the `game sky`, `size` and `turn` buttons. `&bg=key` is
    flat magenta in the same frame, for cutting the bird out. After `npm run build`,
    `node scripts/run-ts.mjs scripts/model-tests.ts` (needs `ffmpeg`) writes the test sheets of
    28 Nov 2026 to `docs/screens/model-v2/tests/`: background and outline contrast, size, turn,
    and test 4, the backdrop pushed back (Joud's outline at three scrolls, and the box edges in
    autoplayed game frames). `backdrop --before=<dist dir>` puts another build's pictures beside
    this one's.
  - The game still draws `joud.glb`: v2 and its clips are only in this viewer until approved.
  - The model is built by `tools/blender/build_joud.py`, with the clips' numbers in
    `tools/blender/joud_clips.py` (Blender, run by hand; neither is a game dependency).
    After `npm run build`: `npm run model:shots` writes the stills to `docs/screens/model-v2/`,
    and `npm run model:anim` writes contact sheets and GIFs of the clips to
    `docs/screens/model-v2/anim/`, each clip also at the size a phone shows the bird
    (`*_phone-size.gif`, 26 px per model unit), and the glide without and with the tilt side by
    side. `npm run model:anim -- compare --before=<an earlier joud-v2.glb>` adds
    `before-after_*`: that model without the tilt beside this one. Both need Playwright's
    Chromium; `model:anim` also needs `ffmpeg` on the PATH (a machine tool, like Blender:
    nothing is added to `package.json`).
- **Offline:** `public/play/sw.js` caches what the first load fetched, so the game works offline
  afterwards. It makes no network calls of its own.

### Look (phone only; VR and the fallback are unchanged)
Everything here is render-only: `src/core` is untouched, so it never changes a result.

- **Venue backdrop** (`backdrop.ts`): the event plaza in Joud's flat campaign style, as two
  merged vertex-coloured meshes.
  - **Source:** measurements (numbers only) from the Talaatna booth planner: `data/venue.json`
    (Main Building façade, palms) and `data/assets.json` (booth).
  - **Far layer:** the 13 m façade with three rows of paired windows per 6.4 m bay and the
    5.7 m entrance portal.
  - **Near layer:** 3 m booths with 0.7 m round signs (plain brand discs, no logos), palms
    (4.8 m trunks, 10 fronds) at the measured spacing, and decorative string lights.
  - **Scale:** 1 m = 0.075 (far) or 0.085 (near) lane units.
  - **Colour:** faded towards cream, so obstacles stay the most saturated thing on screen, then
    pushed back into the sky's blue (`FAR_RECEDE` 55 % and 5 % darker, `NEAR_RECEDE` 40 %), so
    Joud's cream edges stay clear in front of the façade and the booths (28 Nov 2026: at most
    4.4 % of his outline lost, was 31.9 %; test 4 in `scripts/model-tests.ts`).
  - **Parallax:** the layers move with the obstacles at 0.15× and 0.4× and wrap per tile.
- **Campaign box faces** (`box-art.ts`): one canvas atlas of 4 × 4 tiles in the face's shape.
  - **Tiles:**
    - red-orange words أنا / ادّعـــم / جـــود in butter
    - deep-green flowers and leaves
    - butter crescent moons and sparkles
  - **Words:** on one column per obstacle, the three boxes at the gap read the phrase top to
    bottom.
  - **Rendering:** boxes are unlit instanced planes with a per-instance `aTile` attribute. A box
    cut at the lane edge crops its face rather than squashing it.
  - **Font:** the system font, as DG Mataryah isn't available.
- **Cues** (`cues.ts`): a round badge on a box next to each gap that pays more than a gate,
  hidden once the obstacle is passed.
  - Values come from the ruleset's points table.
  - They sit on the column without the words.
  - Cues are gameplay information, so they stay on with `?fx=0` and on every tier.

  | kind | badge |
  |---|---|
  | gate | none |
  | stairs, updraft | +2 |
  | narrow | +3 |
  | moving | +3 with ↑↓ arrows |
  | fork | +5 on a red-orange disc on the middle block, with two sparkles at the risky gap's lips |

- **Score burst:** the VR petal/sparkle burst (`src/scene/burst.ts`, unchanged), scaled to the
  phone lane. It plays at the bird on each score (twice for 3 points or more) and on a flower
  pickup.

### Performance tiers (`src/mobile/perf.ts`)
| tier | pixel-ratio cap | antialias | effects (flower spin, updraft motion, backdrop parallax, score burst) | flower strip and near backdrop | box atlas | bird |
|---|---|---|---|---|---|---|
| low | 1 | off | off | hidden | half resolution | placeholder (0.9k tris) |
| medium | 1.5 | on | on | shown | full | joud.glb (6k tris) |
| high | 2 | on | on | shown | full | joud.glb |

- **Starting tier:** chosen from `hardwareConcurrency`, `deviceMemory` (absent on Safari, which
  does not count against the device), screen size and DPR. See `chooseTier`.
- **Watchdog:** during a round, if the average frame is over 20 ms for 3 s, the game drops one
  tier. It never steps up. Antialias stays as created, because a WebGL context cannot change it.
- **Override:** `?tier=low|medium|high` forces a tier and turns the watchdog off. The debug HUD
  shows the tier.
- **Rendering only:** tiers never touch the sim, so runs replay identically on every tier.
- **Budget (same as VR):** under 50 draw calls (the page uses 8–12; 8 on low), no shadows, no
  post-processing, Lambert/Basic materials.

### Practice
- Same ruleset, a fresh random seed every round.
- Clearly labelled: a «جولة تدريب» badge during play, «جولة تدريب» as the game-over title, and
  no impact points.
- Never submitted, never logged as ranked, never counted as a best score.

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
