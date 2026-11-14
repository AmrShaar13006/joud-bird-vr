# Prompt 04 — Plain Three.js fallback shell (insurance)

```
Read CLAUDE.md and docs/spec.md. Branch: feat/fallback.

Build a second entry point, served at /fallback.html, that runs the SAME src/core with plain
Three.js and WebXR (no IWSDK imports anywhere under src/fallback/).

1. Use three@0.186.0 for this entry only. If two Three.js copies cause a bundling conflict with
   IWSDK's super-three, stop and tell me the options before changing anything.
2. renderer.xr.enabled, VRButton-style Enter VR button, setFoveation(1),
   requestSession('immersive-vr', { optionalFeatures: ['local-floor'] }).
3. Fixed-step loop inside renderer.setAnimationLoop (STEP = 1/120, clamp 0.1 s).
4. XR input: one 'selectstart' listener on the session = flap; poll gamepad buttons[4]/[5] for
   restart/pause with rising-edge detection. Desktop input identical to the main build.
5. Reuse the bird, panels and ?debug=1 HUD code where it doesn't depend on IWSDK.
6. Verify in desktop mode; report draw calls. npm run build must output both entries.

This is insurance: keep it minimal. End with the two lists from CLAUDE.md.
```

Use it on Sunday if the IWSDK build fails P1 and can't be fixed in 30 minutes.
