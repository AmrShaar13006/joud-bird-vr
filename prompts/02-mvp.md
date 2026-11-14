# Prompt 02 — Playable MVP with the placeholder bird

```
Read CLAUDE.md, docs/spec.md and docs/testing.md. Branch: feat/mvp.

Build the Joud Bird MVP on IWSDK with a placeholder bird (a single orange sphere is fine for now).

1. src/core (framework-free TypeScript): CFG with URL overrides, physics (integrate,
   circleVsRect), obstacle pool, scoring and difficulty, state machine (attract, ready, playing,
   gameOver, paused), InputBus. Vitest tests for all of it (testing tier A).
2. IWSDK layer: PlayRig placed on the first XR frame 2.5 m ahead at eye height (local-floor,
   fallback local), recentre on the Attract panel; select on either controller = flap;
   buttons[4] = restart, buttons[5] = pause; 0.8 s restart lockout; pause on visibility-blurred;
   session end returns to the Attract page.
3. Desktop mode: Space / click / touch to flap, R restart, Esc or P pause.
4. Panels and score as canvas-texture planes (Arabic text via 2D canvas, RTL). Attract panel shows
   "Joud Bird" and today's best score from localStorage.
5. ?debug=1 HUD (fps, input profile, last button index, XR state, last error, bird/model mode) and
   URL overrides for g, flap, gap, speed, dist, h.
6. Keep within the performance budget in docs/spec.md. Report draw calls and triangles from
   renderer.info in desktop mode.
7. Verify tier B in the IWER emulator: flap, collision, score, restart in-session, pause on blur.
   Verify tier C in desktop mode.

No new dependencies. Do not change the super-three version. Small commits; do not merge.
End with the two lists from CLAUDE.md.
```

Exit: **M2a** — a full round plays in desktop mode and IWER, deployed on Vercel.
