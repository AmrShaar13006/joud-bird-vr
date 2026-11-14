# Testing

## Five tiers (only D needs the Quest)
| Tier | What it proves | Who |
|---|---|---|
| A. No XR | `src/core` rules with Vitest: gravity, flap, collision, scoring, difficulty, state machine. Asset checks: triangles, texture sizes, file size. | Agent |
| B. Emulator (IWER) | XR session starts; select on either emulated controller flaps; A/X and B/Y; restart in-session; recentre; pause on blur; screenshots of the play window. | Agent (IWSDK tools) |
| C. Browser | Desktop mode in Chrome and Edge (Space, click, touch); Vercel HTTPS deploy; bundle size; draw calls from `renderer.info`. | Agent + 5 min of Amr |
| D. Real Quest 3 | Trigger feel in both hands; window height/distance seated; text legibility; Joud's colour and scale; comfort; real fps and heat; Quest Browser prompts and haptics permission; headset removed mid-game; power-bank drain; offline cache. | Amr + 1 tester |
| E. Final | 20 min continuous play on the power bank; operator rehearsal; regression after fixes. | Amr + operators |

Agent testing on the physical headset (ADB, Developer Mode) is out of scope: it only proves
session state with synthetic controllers.

## Sunday Quest checklist (2.5 h, run in order, record pass/fail)
| Time | Block | Checks |
|---|---|---|
| 0:00–0:15 | Setup | Battery % noted; power bank connected for the whole session. Wi-Fi or hotspot. Skip big system updates. Open the Vercel URL with `?debug=1`, bookmark it, set a stationary seated boundary. Note the Quest Browser version. |
| 0:15–0:35 | P1 Smoke (go/no-go) | Enter VR; window at eye height, 2.5 m ahead, seated; trigger flaps with left then right hand; collision → game over; restart without leaving VR; exit and re-enter VR. **If the IWSDK build fails and isn't fixed in 30 min, switch to the Three.js fallback URL.** |
| 0:35–1:00 | P2 Input | HUD shows the expected controller profile; A/X restarts, B/Y pauses; 0.8 s lockout prevents accidental restarts; menu button does nothing; controllers put down → no ghost flaps from hands; remove and refit the headset. |
| 1:00–1:25 | P3 Visual and performance | HUD fps steady at 72+ for 5 min with the placeholder, then with `?model=joud`; Joud recognisable at 2.5 m (colours, scale); score and panels legible; obstacles readable; no flicker. A second tester plays 3 rounds and reports comfort. |
| 1:25–1:50 | P4 Tuning | Adjust `g`, `flap`, `gap`, `speed`, `dist`, `h` in the URL until a first-time player survives 3–8 obstacles. Write the values down; they become the defaults. |
| 1:50–2:15 | P5 Operations | Battery % after ~1.5 h on the power bank; airplane mode + reopen bookmark; haptics permission; time one full visitor cycle (brief, fit, play, clean). |
| 2:15–2:30 | P6 Wrap-up | List issues; pick at most 3 fixes for tonight; record a 30 s video as proof; confirm the next headset window. |

Bring: headset, both controllers, spare AA batteries, power bank, USB-C PD cable, a chair without
wheels, the second tester, a laptop with the repo open.
