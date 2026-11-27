// ?debug=1&sounds=1: a panel with a button per sound, plus the 20-second percussion preview.
// Loaded lazily and only behind the debug flag; never part of the normal page.

import type { Cue } from './director';
import type { SoundEngine } from './engine';
import { schedulePreview } from './percussion';
import { FLAP_VOICES } from './voices';

const CUES: [Cue, string][] = [
  ['flap', 'flap'],
  ['point', '+1'],
  ['point2', '+2'],
  ['point3', '+3'],
  ['point5', '+5'],
  ['bloom', 'flower'],
  ['hit', 'hit'],
  ['best', 'new best'],
];

export function mountSampler(sound: SoundEngine): void {
  const box = document.createElement('div');
  box.id = 'sound-sampler';
  box.dir = 'ltr';
  box.style.cssText =
    'position:fixed;left:8px;right:8px;bottom:8px;z-index:50;display:flex;flex-wrap:wrap;gap:6px;' +
    'padding:8px;background:#0b3d2ecc;border-radius:12px;font:600 14px system-ui';
  const add = (label: string, run: () => void): void => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = 'padding:10px 12px;border:0;border-radius:8px;background:#fff3c4;color:#0b3d2e';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      sound.unlock();
      run();
    });
    box.appendChild(b);
  };
  // Points climb the chime like a run: each press is the next point.
  let run = 0;
  for (const [cue, label] of CUES) add(label, () => sound.play(cue, cue.startsWith('point') ? ++run : run));
  add('reset run', () => (run = 0));
  add(`flap voice: ${sound.flapVoice}`, () => {
    const i = FLAP_VOICES.indexOf(sound.flapVoice);
    sound.flapVoice = FLAP_VOICES[(i + 1) % FLAP_VOICES.length];
    box.querySelectorAll('button')[CUES.length + 1].textContent = `flap voice: ${sound.flapVoice}`;
  });
  add('percussion 20 s', () => {
    const k = sound.percussionKit();
    if (k) schedulePreview(k, k.ctx.currentTime + 0.05);
  });
  box.addEventListener('pointerdown', (e) => e.stopPropagation());
  document.body.appendChild(box);
}
