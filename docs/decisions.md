# Decisions

| # | Date | Decision | Why |
|---|---|---|---|
| 1 | 13 Nov | IWSDK 1.1.0 on top of a framework-free `src/core`; plain Three.js (the same super-three 0.185.0 that IWSDK pins) as fallback shell on the same core | Agents build it, so IWSDK's tooling helps; the core keeps a cheap escape route if IWSDK misbehaves on the device |
| 2 | 13 Nov | Seated, fixed camera, 2.8 × 1.6 m arcade window 2.5 m ahead | No vection → no motion sickness; works for kids and adults |
| 3 | 13 Nov | No physics engine; circle-vs-rectangle collision | Five lines of physics; predictable |
| 4 | 13 Nov | Private repo in Amr's personal GitHub, Vercel Hobby, merge commits by Amr | Hobby won't deploy private org repos, and only deploys the owner's commits |
| 5 | 14 Nov | No headset before Sunday: debug HUD + URL tuning instead of on-device agent testing | Tuning on the headset without redeploys |
| 6 | 14 Nov | Joud Bird: one bird, round outfit (glasses + flowered vest); glasses and legs built in code | The only outfit drawn flying; thin parts fail in AI generation |
| 7 | 14 Nov | `joud.glb` (Meshy, optimized): 6,176 tris, 368 KB, scale 0.2, +Z front | Within the ≤ 8k tris / ≤ 1 MB budget |
| 8 | 14 Nov | VR goes live Tue 17 Nov 16:00 (Priority 1); Black Box on Wed 18 | Families day suits VR; Amr stays on VR until Tuesday |
| 9 | 14 Nov | Repo set up Saturday night; schedule re-baselined in `plan.md` | Repo didn't exist yet |
| 10 | 14 Nov | IWSDK 1.1.0 (what `@latest` installed) with super-three 0.185.0; the fallback uses that same super-three, not three@0.186.0 | One copy of Three.js ships; no version conflict between the two shells |
| 11 | 23 Nov | Mobile step 1: a third page `play/` on the same `src/core`, portrait phones, no WebXR/IWSDK | Joud's initiative runs until 30 Nov; phones reach far more people than one headset |
| 12 | 23 Nov | Rulesets with ids: `vr-1` (the 17 Nov VR game, gates only) and `mobile-1`. A run = (ruleset id, mode, seed, flap ticks). Constants never change in place: a new id plus regenerated fixtures; a stored constants hash enforces it | The server replays submitted runs; old runs must keep replaying to the same score |
| 13 | 23 Nov | Mobile simulates at 60 Hz (VR stays 120 Hz) | Phones refresh at 60–120 Hz; half the steps per second; render interpolation keeps 90/120 Hz screens smooth |
| 14 | 23 Nov | Plain doubles with a banned-function list (no trig/exp/log/pow, `**`, clock, `Math.random`), not fixed-point maths | `+ - * /` and `sqrt` are exactly specified by IEEE 754, so V8 and JavaScriptCore agree bit for bit; fixed point would have meant rewriting the core. Fixtures prove it in Node, Deno, Chromium and WebKit |
| 15 | 23 Nov | The core is shipped to Deno as one generated ESM file (`supabase/functions/_shared/joud-sim.js`, Vite library mode, committed; a test fails when stale) | Deno can't import `src/core` (extensionless imports); one file needs no new dependency or import map, and the server runs exactly what was tested |
