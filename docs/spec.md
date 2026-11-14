# Joud Bird VR — Game spec

Source: Rev 3 plan (section 5) and Addendum A, 14 Nov 2026.

## Experience
- Seated player on a fixed chair without wheels. The camera never moves.
- A 2.8 × 1.6 m play window floats 2.5 m ahead at eye height (~58° wide). Sky, ground and frame
  are static; only obstacles move. This avoids motion sickness.
- Placement: on the first XR frame, read the head pose and put the PlayRig 2.5 m ahead along the
  horizontal gaze, at eye height. A "recentre" button on the Attract panel redoes this for the
  next player. Reference space `local-floor`, falling back to `local`.
- Round length 60–120 s; one visitor every ~3.5–4 min (~15 per hour).
- Best score of the day is saved in localStorage on the headset and shown on the Attract panel.
  No names, no backend.

## Scene
```
Scene
├─ SkyDome (static gradient, MeshBasicMaterial)
├─ Backdrop (static low-poly dunes / campus skyline, 1 merged mesh)
├─ HemisphereLight + 1 DirectionalLight (no shadows)
└─ PlayRig (placed once per player)
   ├─ Frame (thin border around the lane)
   ├─ Lane (2D coords: x right, y up, origin = lane centre)
   │  ├─ Bird (Joud GLB or primitive placeholder, collision radius 0.12 m)
   │  ├─ Obstacles (pool of 5 pairs, reused, never re-created)
   │  ├─ Floor / ceiling strips (collision bounds)
   │  └─ ScoreText (canvas texture, redrawn only on change)
   └─ Panels (Attract / GameOver / Paused, toggled visible)
```

## Core (src/core)
| File | Contents |
|---|---|
| config.ts | `CFG` constants + URL overrides |
| physics.ts | `integrate()`, `circleVsRect()` |
| obstacles.ts | pool, spawn, recycle, scoring |
| game.ts | state machine: attract → ready → playing → gameOver; paused |
| input.ts | `GameCommand`, `InputBus` |
| core.test.ts | Vitest for all of the above |

Starting constants (metres, seconds; tuned on the headset Sunday):
```ts
export const CFG = {
  gravity: -5.5,          // m/s²
  flapVelocity: 2.1,      // SET, not added: vy = flapVelocity
  maxFall: -3.5,
  birdRadius: 0.12,
  birdX: 0.6,             // fixed x in lane coords (flying left)
  pipeWidth: 0.35,
  gapStart: 0.70, gapMin: 0.52, gapShrinkPerPoint: 0.01,
  spacing: 1.3,
  speedStart: 1.1, speedMax: 1.5, speedPerPoint: 0.02,
  laneW: 2.8, laneH: 1.6,
};
```
- No physics engine. Collision = closest point on the rectangle to the circle centre vs radius.
  Floor and ceiling are bounds too.
- +1 point when the bird passes an obstacle's trailing edge. Difficulty rises with score up to the
  caps above.

## Input
| Command | Quest Touch Plus | Desktop |
|---|---|---|
| Flap / Start | Trigger on either hand (`selectstart` on the session, not polling) | Space, click, touch |
| Restart | Trigger after a 0.8 s lockout, or A / X (`buttons[4]`) | Space or R |
| Pause | B / Y (`buttons[5]`), or automatically on `visibility-blurred` | Esc or P |
| Grip / thumbstick / menu | Unused (menu is reserved by the system) | — |

- In IWSDK, use its XR input layer and map it onto the InputBus. Gaze-and-pinch and hand tracking
  are not in the MVP.
- Haptics: short pulse on hit via `gamepad.hapticActuators`. Needs the Quest Browser permission;
  the game must work without it.

## Session lifecycle
- `isSessionSupported('immersive-vr')` decides between the "Enter VR" button and desktop-only mode.
- `requestSession('immersive-vr', { optionalFeatures: ['local-floor'] })`. No other features.
- `visibility-blurred` → pause. `end` → back to the Attract page with a big Enter VR button.
- Stay at the default 72 Hz. Request 90 Hz only if proven stable on the device.

## Performance budget (Quest 3)
| Metric | Target |
|---|---|
| Frame rate | 72 fps steady (13.9 ms) |
| Draw calls | < 50 (backdrop merged; obstacles as 10 meshes or InstancedMesh) |
| Triangles | < 100k total; bird ≤ 8k |
| Textures | ≤ 1024², total < 4 MB |
| Download | < 3 MB |
| Foveation | `renderer.xr.setFoveation(1)` |

## Character
- `public/models/joud.glb`: 6,176 triangles, 1 draw call, 368 KB. Load it when `?model=joud` is
  set; on any error fall back to the primitive placeholder.
- Scale 0.2 (body radius ≈ 0.12 m). +Z is the front; rotate −50° to −60° about Y so it faces the
  flight direction while the player still sees the vest and face.
- Glasses and legs are built in code as children of the model. Positions are in
  `docs/joud-brief.json` → `model.landmarks_model_units` and `glasses_hint`.
- Procedural animation only: idle bob, squash on flap, tilt from vertical speed (±30°), hit flash.

## Debug tools
- `?debug=1`: in-VR HUD with fps, input profile, last button index, XR session state, last error,
  bird/model mode.
- URL tuning: `?g=-5.5&flap=2.1&gap=0.7&speed=1.1&dist=2.5&h=0` overrides the constants, so tuning
  on the headset needs no redeploy.

## Sound and text
- Three original Web Audio effects: flap, score, hit. First sound only after a user gesture.
- Arabic panel text on a 2D canvas texture (RTL works natively).

## Deployment
- Primary: Vercel HTTPS URL opened in Quest Browser, phone hotspot as internet backup.
- Offline cache via Service Worker: untested; test it on Monday before relying on it.
- Last resort: desktop mode on a TV so the booth stays open.
