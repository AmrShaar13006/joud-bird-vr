# Joud Bird VR

A seated WebXR arcade game for Meta Quest 3, played in Quest Browser. Players flap Joud's mascot
through gaps with the controller trigger. Built for the DSC booth at "طلعتنا اليوم"
(Al Yamamah University × جمعية جود). **Live Tue 17 Nov 2026, 16:00.**

Stack: Meta IWSDK 1.0 (Three.js + WebXR), TypeScript, Vite, Vitest. Hosted on Vercel.

## Repo map
| Path | What |
|---|---|
| `CLAUDE.md` | Rules for coding agents. Read first. |
| `docs/spec.md` | What we're building: scene, physics, input, budgets |
| `docs/plan.md` | Deadlines, gates and the sacrifice ladder |
| `docs/testing.md` | Test tiers and the Sunday headset checklist |
| `docs/decisions.md` | Decision log |
| `docs/joud-brief.json` | Locked character brief + model data (scale, facing, landmarks) |
| `docs/references/` | Official Joud references (private, event use only) |
| `prompts/` | Ready-to-paste Claude Code prompts, run in order 01 → 04 |
| `public/models/joud.glb` | Optimized Joud model (6,176 tris, 368 KB) |
| `src/core/` | Framework-free game logic (after scaffolding) |

## First-time setup (Windows)
1. Install Git, Node.js LTS and (optional) GitHub CLI `gh`, then run `gh auth login`.
2. In this folder: `powershell -ExecutionPolicy Bypass -File .\setup-repo.ps1`
3. In Vercel: **Add New → Project →** import `joud-bird-vr` from your personal GitHub.
   Framework preset: Vite (after prompt 01 adds `package.json`).
4. Open Claude Code in this folder and run `prompts/01-scaffold.md`.

## Commands
Filled in by prompt 01: `npm run dev`, `npm test`, `npm run build`.

## On the headset
Open the production URL in Quest Browser. Add `?debug=1` for the HUD, `?model=joud` for the GLB
bird, and `?g=&flap=&gap=&speed=&dist=&h=` to tune without redeploying.

The Joud mascot belongs to جمعية جود. Keep this repo private.
