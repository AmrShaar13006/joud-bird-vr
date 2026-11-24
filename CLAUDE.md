# CLAUDE.md — joud-bird-vr

Joud Bird VR: a seated, Flappy-style WebXR game for Meta Quest 3 (Quest Browser), for DSC's booth at
"طلعتنا اليوم" (Al Yamamah University × جمعية جود). Goes live **Tue 17 Nov 2026, 16:00 (Riyadh)**.
One human (Amr) reviews and merges. You build. Reliability beats features.

Read before any task: `docs/spec.md` (what to build), `docs/plan.md` (deadlines),
`docs/testing.md` (how to prove it), `docs/joud-brief.json` (the character, locked).

## Architecture (do not change)
- Built on IWSDK 1.1.0 (super-three 0.185.0). Look up IWSDK APIs with the project's IWSDK MCP/RAG tools. Never guess an API.
- All game logic lives in `src/core/`: plain TypeScript with no imports from `@iwsdk/*`, `three`
  or the DOM. The shells only read core state and write it to scene objects.
- Two shells over the same core: the IWSDK game (`index.html` → `src/index.ts`, `src/systems`,
  `src/components`) and the plain Three.js + WebXR fallback (`fallback.html` → `src/fallback/`)
  in case IWSDK misbehaves on the headset. `src/scene` is view code shared by both (play window,
  panels, strings, HUD, desktop input) and has no IWSDK imports. Both use the same super-three
  0.185.0 that IWSDK pins, so only one copy of Three.js ships (a chunk shared by both pages).
- Input reaches the core only as four commands through the InputBus: `flap`, `start`, `restart`,
  `pause`.
- Fixed-step simulation at 1/120 s, clamped after hitches.

## Hard rules
- Target: Meta Quest 3 in Quest Browser only. Hold 72 fps: no shadows, no post-processing,
  Lambert/Basic materials, under 50 draw calls, WebGL only (no WebGPU), minimal transparency.
- The camera never moves. Only obstacles move inside the play window.
- No new dependencies without Amr's approval (Vitest is pre-approved). Do not change the
  super-three version that IWSDK pins.
- No Flappy Bird names, art or sounds. The game is "Joud Bird" and the bird is Joud's mascot.
- Joud's look comes only from `docs/joud-brief.json` and `docs/references/`. Never invent traits,
  colours or accessories.
- Arabic text in VR is drawn on a 2D canvas and used as a texture. No 3D-text libraries.
- Do not edit `public/models/joud.glb`. Glasses and legs are built in code.
- Never commit secrets, `.env` files, or files over 5 MB.

## Workflow
- One task per branch: `feat/<topic>` or `fix/<topic>`. Small PRs (aim < 300 lines).
- Before you say a task is done: `npm test` and `npm run build` pass.
- Every report ends with two lists: **Verified by me** (tests, emulator, desktop) and
  **A human must still check on the Quest** (trigger feel, legibility, comfort, real fps, heat).
- Headset/emulator runs prove session state only. Never claim something works on the Quest
  unless Amr tested it there.
- Amr merges with merge commits (Vercel Hobby only deploys his commits). Do not squash or
  force-push `main`.
- *(Historical: the VR event's feature freeze, Sun 15 Nov 22:00 – Wed 18 Nov, is over. New work
  on `feat/*` branches is allowed again.)*

## Commands
Node: `>=20.19 <21 || >=22.12 <23 || >=24` (see `engines`; `.nvmrc` pins 22.12.0).
- `npm install` — install deps (lockfile is committed; prefer `npm ci` on clean machines)
- `npm run dev` — IWSDK-managed dev server at `https://localhost:8081/` (self-signed cert,
  IWER emulator injected on localhost) and opens a managed Chromium window. Port 8081 is fixed:
  if busy it fails instead of picking another port.
- `npm run dev:status` / `npm run dev:down` — show the runtime URLs / stop a background runtime.
  `npx iwsdk dev up --headless` starts it in the background without a visible window.
- `npm test` — Vitest, runs `src/core/**/*.test.ts` in Node (config: `vitest.config.ts`,
  deliberately separate from `vite.config.ts`). `npm run test:watch` for watch mode.
- `npm run typecheck` — `tsc --noEmit`. Run before testing in a browser: type errors can stop
  IWSDK systems from starting without any console error.
- `npm run build` — production build to `dist/`: `index.html` (IWSDK game) and `fallback.html`
  (plain Three.js fallback), plus `check/` (determinism check page). `npm run preview` serves it
  (HTTPS, self-signed). In dev the fallback is at `https://localhost:8081/fallback.html`.
- `npm run test:determinism` — fixtures in Node, the sim bundle in Node and Deno, `check/` in
  Chromium and WebKit; prints a runtime × runs-passed table. Needs Deno and Playwright browsers.
- `npm run build:sim` — rebuild `supabase/functions/_shared/joud-sim.js` after any `src/core`
  change (a test fails when it is stale). `npm run fixtures` — only after a new ruleset id.

## Mobile (play/)
Joud's initiative runs until Mon 30 Nov 2026. Full details: `docs/mobile.md`.
- **Target:** portrait phones in mobile Chrome and Safari. No WebXR, no IWSDK. The Quest rules
  above (72 fps, draw calls, Quest Browser) apply to the VR pages; mobile keeps the same render
  budget (< 50 draw calls, no shadows or post-processing, Lambert/Basic).
- **Rulesets:** `vr-1` (VR, unchanged) and `mobile-1` (60 Hz). A run is (ruleset id, mode, seed,
  flap ticks). The server will replay runs, so results must match in V8 and JavaScriptCore.
- **Determinism rules** for `src/core` (enforced by `determinism-guard.test.ts`):
  - Only `+ - * /`, `Math.min/max/abs/floor/ceil/round/trunc/sign/sqrt/imul` and bit ops.
  - No trig, exp, log or pow, no `**`, no `Math.random`, `Date.now`, `new Date`,
    `performance`, `crypto` or timers.
  - Time is integer ticks. Seeds come from the shell.
  - Never edit a ruleset in place: new id plus `npm run fixtures`.

## IWSDK notes
Merged from the generator's `AGENTS.md` (still at the repo root as the full reference, with
path-scoped rules in `.claude/rules/` and skills in `.claude/skills/`). Where they conflict with
the rules above, **this file wins**: the IWSDK skills assume a scene-editor, JSON-composed app;
ours keeps game logic in `src/core` and builds the play window in code.
- `iwsdk.config.json` is the project authority (scene, asset/component modules, XR features,
  emulator device), not `vite.config.ts`. Editing it restarts Vite. `src/index.ts` passes
  `virtual:iwsdk-project` whole to `World.create()`; do not hand-build those options.
- In `src/systems` and `src/components`, import Three.js from `@iwsdk/core`. `src/scene` and
  `src/fallback` import from `three`: it is the same single super-three install (`npm ls three`
  shows one, deduped), so there is no duplicate instance. Never add another `three` version.
- `src/assets.ts` runs twice, in the app and in the editor: deterministic, no World/DOM/timers.
- Components live in system-free modules and are listed in `src/components.ts` via
  `defineComponents()`. Register systems explicitly with `world.registerSystem()`.
- Systems: use queries, not hand-kept entity arrays; never allocate in `update()`; use
  `signal.peek()` in `update()`; push subscription teardowns into `this.cleanupFuncs`.
- Create entities with `world.createTransformEntity()`, not `scene.add()`; free them with
  `entity.dispose()` (not `destroy()`, which leaks GPU memory). Vector fields: use
  `entity.getVectorView()`, since `setValue` throws on Vec/Color fields.
- XR input: `this.input.xr.gamepads.left/right` with `InputComponent.Trigger` etc.
  `world.visibilityState` is `NonImmersive | Visible | VisibleBlurred`; pause on blurred.
- Proof levels: `browser_screenshot` (runtime) proves systems run; `scene_screenshot` (editor)
  does not. Pose/interaction claims need an active XR session (`npx iwsdk xr status`).
- MCP and CLI are the same surface: `npx iwsdk <domain> --help` (`xr`, `browser`, `ecs`,
  `scene`, `ui`). MCP servers `iwsdk-runtime` and `iwsdk-reference` come from `.mcp.json`,
  which `npx iwsdk adapter sync --tools claude` writes with absolute paths (so it is
  gitignored). API lookup (`iwsdk-reference`) needs a one-time `npm run reference:warmup`.
- Hand tracking is off in `iwsdk.config.json` (not in the MVP). Locomotion, grabbing and physics
  are off.
