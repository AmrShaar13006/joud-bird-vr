// Every user-facing string in the game, in one place (Arabic first).
// Rule: no runs of Latin letters joined by "/" inside Arabic sentences —
// right-to-left layout reorders them ("A / X" shows as "X / A").
// The debug HUD is developer-only and stays out of this file.

import type { Mode } from '../core/config';

export type InputMode = 'xr' | 'desktop';

export const STRINGS = {
  title: 'Joud Bird',
  /** Official Arabic name of the mascot (docs/joud-brand.md). */
  mascot: 'العصفورة جود',

  start: { xr: 'اضغط الزناد للبدء', desktop: 'اضغط المسافة أو انقر للبدء' },
  flap: { xr: 'اضغط الزناد للطيران', desktop: 'المسافة أو النقر للطيران' },
  again: { xr: 'اضغط الزناد للعب مجددًا', desktop: 'اضغط المسافة للعب مجددًا' },
  resume: { xr: 'اضغط الزناد للمتابعة', desktop: 'اضغط المسافة للمتابعة' },

  bestToday: (n: number) => `أفضل نتيجة اليوم: ${n}`,
  newBest: 'رقم قياسي جديد لليوم!',
  roundOver: 'انتهت الجولة',
  paused: 'متوقف مؤقتًا',

  chooseMode: 'اختر المستوى',
  modeName: { easy: 'سهل', normal: 'عادي', hard: 'صعب' } as Record<Mode, string>,
  modeLine: (m: Mode) => `المستوى: ${STRINGS.modeName[m]}`,
  /** Desktop key for each mode button. */
  modeKey: { easy: '1', normal: '2', hard: '3' } as Record<Mode, string>,

  recentre: 'إعادة التوسيط',
  recentreLatin: 'Recentre',

  // 2D attract page (index.html / fallback.html)
  enterVR: 'ادخل الواقع الافتراضي · Enter VR',
  desktopHint:
    'طيران: المسافة أو النقر · إعادة: R · إيقاف: Esc أو P · المستوى: 1 أو 2 أو 3',
  /** Same hint for a page without the mode picker. */
  desktopHintNoPicker: 'طيران: المسافة أو النقر · إعادة: R · إيقاف: Esc أو P',
} as const;
