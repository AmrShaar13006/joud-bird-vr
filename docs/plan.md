# Plan — re-baselined Sat 14 Nov 2026, 20:40 (Riyadh); order updated Sat 23:00

The repo starts tonight, so the Saturday-morning MVP slot from Addendum A is gone. The headset
session on Sunday and the Tuesday go-live do not move. Priority: playable on Quest > character >
polish.

| When | Amr | Claude Code | Exit criterion |
|---|---|---|---|
| Sat 21:00–21:30 | Run `setup-repo.ps1`, push to GitHub, import into Vercel | — | Empty repo deployed from your account |
| Sat 21:30–02:00 | Review, play desktop mode | `prompts/01-scaffold.md`, `02-mvp.md`, then **05 difficulty**, then **04 fallback** | **M2a**: full round in desktop + IWER with the placeholder bird, deployed on Vercel. Difficulty modes merged; fallback URL deployed |
| Sun 09:00 – headset session | Pick the bird | **03 bird**, then **06 branding**, then **07 wow pass**. All three must land before the headset session | **Character gate 13:00**: Joud GLB passes, or the placeholder ships |
| Sun headset window (2.5 h) | `docs/testing.md` checklist + 1 tester | — | **M2b**: plays on Quest 3 with real controllers |
| Sun after session – 21:30 | Choose max 3 fixes | Fixes | — |
| **Sun 22:00** | **Feature freeze** | Bug fixes only from here | — |
| Mon | Offline cache test; after dark, test the headset under booth lighting | Fixes, panels polish if time | Tag `v1.0.0` |
| Tue 14:00 | Last merge and deploy | — | Production URL final |
| Tue 15:00 | Booth setup, bookmark URL, power bank on | — | — |
| **Tue 16:00** | **VR live** (no coding) | — | — |
| Wed | Max 2 h of fixes in the morning; VR runs day 2 | — | — |

## Sacrifice ladder (drop from the top when behind)
1. 07 effects (score petals, sparkles and other wow-pass flourishes).
2. 07 world detail (keep a gradient sky and a flat ground strip).
3. Haptics, 90 Hz, casting to a screen.
4. Any wing animation (keep tilt, squash, bob).
5. The Joud GLB → code-built placeholder in the brief's colours (decided Sun 13:00).
6. Offline cache → phone hotspot.
7. Custom panel art (illustrations) → plain canvas-text panels in the brand colours.
8. VR itself: if the Sunday session fails and is not fixed by 20:00, run desktop mode on a TV.

Never sacrificed: player safety and hygiene, the operator runbook, the difficulty modes (05) and
the branding (06: name, colours, taglines).

## Open items
- Joud's written OK to use the mascot in 3D/AI tools.
- Headset: exact Sunday time window, who brings it, availability Mon–Wed.
- Power bank 24 W+ USB-C PD and a 2–3 m USB-C PD cable.
- Event hours: 3–9 PM (reel) vs 4–10 PM (Amr).
