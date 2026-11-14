# Prompt 01 — Scaffold the IWSDK app (paste into Claude Code at the repo root)

```
Read CLAUDE.md and docs/spec.md first.

Task: scaffold the IWSDK 1.0 app into this repo without losing what is already here
(CLAUDE.md, README.md, docs/, prompts/, public/models/joud.glb, .gitignore, .gitattributes,
.editorconfig, setup-repo.ps1).

1. Create branch feat/scaffold.
2. Check the Node version IWSDK needs and tell me if mine is too old before going further.
3. Use Meta's official generator (npm create @iwsdk@latest). Read its --help and the IWSDK docs
   first; do not guess flags. Choose: VR, TypeScript, the smallest starter, no optional extras
   (no physics, no hand tracking, no AR). Generate it in a temporary folder OUTSIDE this repo,
   then move the generated files into the repo root.
   - Never overwrite CLAUDE.md, README.md or anything in docs/, prompts/ or public/models/.
   - If the generator ships its own agent instructions (AGENTS.md, CLAUDE.md, rules), merge the
     useful parts into our CLAUDE.md under a "## IWSDK notes" heading instead of replacing it.
   - If it sets up an MCP config for Claude Code (e.g. .mcp.json), keep it and tell me to restart
     Claude Code so the IWSDK tools load.
   - Keep the super-three version it pins. Merge .gitignore entries rather than replacing ours.
4. npm install. Add Vitest as a dev dependency and an "npm test" script (vitest run).
   Create empty folders with .gitkeep: src/core, src/systems, src/components, src/scene, src/fallback.
5. Make sure these work and fill the "## Commands" section of CLAUDE.md with the exact commands:
   npm run dev, npm test (passes with one trivial test in src/core), npm run build (outputs dist/).
6. Prove the starter runs: desktop browser, and the IWER emulator if the IWSDK tooling offers it.
7. Commit in small logical commits. Do not push or merge; I review and merge.

Report: Node/npm versions, the generator command you ran, files added, the super-three version,
whether IWSDK MCP tools are available, and the two lists from CLAUDE.md
(Verified by me / A human must still check on the Quest).
```

After it finishes: review, merge `feat/scaffold` into `main` with a merge commit, push.
Vercel should deploy it. Open the URL once on desktop.
