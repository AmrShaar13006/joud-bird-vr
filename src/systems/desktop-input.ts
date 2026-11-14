import type { InputBus } from '../core/input';

/**
 * Desktop mode: Space / click / touch = flap, Enter = start, R = restart,
 * Esc or P = pause. `isActive` gates input while an XR session runs.
 * Returns a teardown function.
 */
export function attachDesktopInput(
  canvas: HTMLElement,
  bus: InputBus,
  isActive: () => boolean,
  onBlur: () => void,
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
        return;
    }
    e.preventDefault();
  };
  const onPointer = (e: PointerEvent) => {
    if (!isActive()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
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
