# Prompt 03 — Joud bird: placeholder, GLB, glasses, legs, animation

```
Read CLAUDE.md and docs/joud-brief.json (the "model" section has scale, facing and landmarks).
Look at docs/references/ for the official look. Branch: feat/bird. Work in src/scene/bird.ts.

1. Placeholder Joud from primitives, using only the brief's colours and proportions: flattened
   cream sphere body, smaller cream head sphere merged on top, vest as a slightly larger partial
   shell in the vest colour with a green collar ring, two flattened cream wing ellipsoids with
   peach tips, small peach tail. Under 1,000 triangles. Fits the 0.12 m collision radius.
2. loadJoudModel(url): when ?model=joud is set, load public/models/joud.glb (no Draco/meshopt
   decoders needed). Scale 0.2, rotate about Y by -55 degrees so it faces the flight direction
   (left) while the player still sees the face and vest. On any load error, fall back to the
   placeholder and show the error in the ?debug=1 HUD.
3. Add to BOTH versions, in code, as children so they inherit scale and rotation:
   glasses = two torus rings (#555655) with a short bridge, placed from the brief's eye
   landmarks and glasses_hint, no lens material; legs = two thin black cylinders with three
   short toes each, trailing backwards and down (legs_hint).
4. Procedural animation only, no skeletons: idle bob, squash on flap, tilt from vertical velocity
   clamped to +-30 degrees, short red flash on hit.
5. Take four desktop-mode screenshots of the GLB version with glasses and legs: front, side,
   back, three-quarter. Save them to docs/screens/ for review.

Add no dependencies. Report triangles and draw calls for both versions. End with the two lists
from CLAUDE.md.
```

Gate **Sun 13:00**: if the GLB version isn't clearly recognisable as Joud, the placeholder
becomes the default and `?model=joud` stays optional.
