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
