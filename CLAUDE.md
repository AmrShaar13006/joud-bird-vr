# CLAUDE.md — joud-bird-vr

Joud Bird VR: a seated, Flappy-style WebXR game for Meta Quest 3 (Quest Browser), for DSC's booth at
"طلعتنا اليوم" (Al Yamamah University × جمعية جود). Goes live **Tue 17 Nov 2026, 16:00 (Riyadh)**.
One human (Amr) reviews and merges. You build. Reliability beats features.

Read before any task: `docs/spec.md` (what to build), `docs/plan.md` (deadlines),
`docs/testing.md` (how to prove it), `docs/joud-brief.json` (the character, locked).

## Architecture (do not change)
- Built on IWSDK 1.0. Look up IWSDK APIs with the project's IWSDK MCP/RAG tools. Never guess an API.
- All game logic lives in `src/core/`: plain TypeScript with no imports from `@iwsdk/*`, `three`
  or the DOM. The IWSDK layer (`src/systems`, `src/components`, `src/scene`) only reads core state
  and writes it to scene objects.
- The same `src/core` must also run under a plain Three.js shell (`src/fallback/`, three@0.186.0)
  so we can switch if IWSDK misbehaves on the headset.
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
- After the feature freeze (Sun 15 Nov 22:00): bug fixes only, on `fix/*` branches.

## Commands (fill in after scaffolding)
- `npm run dev` — local dev server
- `npm test` — Vitest (src/core)
- `npm run build` — production build to `dist/`
