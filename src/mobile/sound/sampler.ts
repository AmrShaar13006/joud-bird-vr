// ?debug=1&sounds=1: a panel with a button per sound, plus the 20-second percussion preview.
// Loaded lazily and only behind the debug flag; never part of the normal page.
// &flap=drop|chatter|pop|spring plays that trial flap (flap-lab.ts) in the game itself, with
// no panel in the way.

import type { Cue } from './director';
import type { SoundEngine } from './engine';
import { LAB_VOICES } from './flap-lab';
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

const TRIALS = Object.keys(LAB_VOICES);

export function mountSampler(sound: SoundEngine): void {
  // A trial flap voice, or '' for the built-in one.
  let trial = new URLSearchParams(window.location.search).get('flap') ?? '';
  if (!LAB_VOICES[trial]) trial = '';
  const useTrial = (): void => {
    sound.flapPlayer = trial ? LAB_VOICES[trial] : null;
  };
  useTrial();
  if (trial) return;
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
  const voiceLabel = (): string => `flap voice: ${trial || sound.flapVoice}`;
  add(voiceLabel(), () => {
    // Built-in voices first, then the trials.
    const all = [...FLAP_VOICES, ...TRIALS];
    const next = all[(all.indexOf(trial || sound.flapVoice) + 1) % all.length];
    if (TRIALS.includes(next)) trial = next;
    else {
      trial = '';
      sound.flapVoice = next as (typeof FLAP_VOICES)[number];
    }
    useTrial();
    box.querySelectorAll('button')[CUES.length + 1].textContent = voiceLabel();
  });
  add('percussion 20 s', () => {
    const k = sound.percussionKit();
    if (k) schedulePreview(k, k.ctx.currentTime + 0.05);
  });
  add('hide panel', () => (box.style.display = 'none'));
  box.addEventListener('pointerdown', (e) => e.stopPropagation());
  document.body.appendChild(box);
}
