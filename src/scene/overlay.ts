import { STRINGS } from './strings';

// The 2D "Attract page" shown outside VR: a big Enter VR button when the
// browser supports immersive-vr, plus a desktop controls hint.

export interface Overlay {
  /** Shown only on the attract screen outside VR. */
  setVisible(visible: boolean): void;
}

export function createOverlay(onEnterVR: () => void, hint: string): Overlay {
  const root = document.getElementById('overlay');
  const button = document.getElementById('enter-vr') as HTMLButtonElement | null;
  const hintEl = document.getElementById('desktop-hint');
  if (!root || !button || !hintEl) {
    return { setVisible: () => {} };
  }
  button.textContent = STRINGS.enterVR;
  hintEl.textContent = hint;

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
    setVisible(visible: boolean) {
      root.hidden = !visible;
    },
  };
}
