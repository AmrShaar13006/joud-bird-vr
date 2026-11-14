import type { InputBus } from '../core/input';

export interface DesktopExtras {
  /** Keys 1/2/3 (index 0/1/2), e.g. to pick a difficulty on the attract screen. */
  onModeKey?: (index: number) => void;
  /**
   * Called on click/touch before it becomes a flap. Return true if the
   * pointer hit something else (a mode button) and must not flap.
   */
  pick?: (clientX: number, clientY: number) => boolean;
}

const MODE_KEYS: Record<string, number> = {
  Digit1: 0,
  Numpad1: 0,
  Digit2: 1,
  Numpad2: 1,
  Digit3: 2,
  Numpad3: 2,
};

/**
 * Desktop mode: Space / click / touch = flap, Enter = start, R = restart,
 * Esc or P = pause, 1/2/3 = difficulty. `isActive` gates input while an XR
 * session runs. Returns a teardown function.
 */
export function attachDesktopInput(
  canvas: HTMLElement,
  bus: InputBus,
  isActive: () => boolean,
  onBlur: () => void,
  extras: DesktopExtras = {},
): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (!isActive() || e.repeat) return;
    switch (e.code) {
      case 'Space':
        bus.push('flap');
        break;
      case 'Enter':
      case 'NumpadEnter':
        bus.push('start');
        break;
      case 'KeyR':
        bus.push('restart');
        break;
      case 'Escape':
      case 'KeyP':
        bus.push('pause');
        break;
      default:
        if (e.code in MODE_KEYS && extras.onModeKey) {
          extras.onModeKey(MODE_KEYS[e.code]);
          break;
        }
        return;
    }
    e.preventDefault();
  };
  const onPointer = (e: PointerEvent) => {
    if (!isActive()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    if (extras.pick?.(e.clientX, e.clientY)) return;
    bus.push('flap');
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') onBlur();
  };

  window.addEventListener('keydown', onKey);
  canvas.addEventListener('pointerdown', onPointer);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    window.removeEventListener('keydown', onKey);
    canvas.removeEventListener('pointerdown', onPointer);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
