// The 2D "Attract page" shown outside VR: a big Enter VR button when the
// browser supports immersive-vr, otherwise a desktop-mode hint.

export interface Overlay {
  setImmersive(immersive: boolean): void;
}

export function createOverlay(onEnterVR: () => void): Overlay {
  const root = document.getElementById('overlay');
  const button = document.getElementById('enter-vr') as HTMLButtonElement | null;
  const hint = document.getElementById('desktop-hint');
  if (!root || !button || !hint) {
    return { setImmersive: () => {} };
  }

  button.addEventListener('click', (e) => {
    e.stopPropagation();
    onEnterVR();
  });
  button.addEventListener('pointerdown', (e) => e.stopPropagation());

  const xr = navigator.xr;
  if (xr) {
    xr.isSessionSupported('immersive-vr')
      .then((ok) => {
        button.hidden = !ok;
      })
      .catch(() => {
        button.hidden = true;
      });
  }

  return {
    setImmersive(immersive: boolean) {
      root.hidden = immersive;
    },
  };
}
