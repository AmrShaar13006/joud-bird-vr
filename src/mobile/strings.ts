// Every user-facing string of the phone game (play/), in one place. Arabic, RTL.
// Numbers are shown with Latin digits (String(n)). Mascot name and taglines come from
// docs/joud-brand.md.

import type { Mode } from '../core/config';

export const M = {
  title: 'Joud Bird',
  mascot: 'العصفورة جود',
  tagline: 'كل فعل خير: بذرة نزرعها',

  chooseMode: 'اختر المستوى',
  modeName: { easy: 'سهل', normal: 'عادي', hard: 'صعب' } as Record<Mode, string>,
  /** Button label, e.g. «عادي ×2». */
  modeButton: (m: Mode, mult: number) => `${M.modeName[m]} ×${mult}`,
  practice: 'تدريب',
  practiceHint: 'جولات التدريب لا تُحتسب',
  play: 'العب',
  best: (n: number) => `أفضل نتيجة: ${n}`,

  tapToFly: 'انقر للطيران',
  paused: 'متوقف مؤقتًا',
  resume: 'تابع',
  pause: 'إيقاف مؤقت',
  home: 'الرئيسية',

  roundOver: 'انتهت الجولة',
  score: 'النتيجة',
  flowers: 'الزهور',
  impact: 'نقاط الأثر',
  practiceRound: 'جولة تدريب',
  newBest: 'جودكم يسوي الفرق',
  goodScore: 'بذرتك اليوم: ثمرة تبقى',
  anyScore: 'الثمرة في الأثر اللي تتركونه',
  again: 'العب مجددًا',

  rotate: 'لف جوالك',
  rotateHint: 'اللعبة تُلعب والجوال عمودي',

  soundOn: 'الصوت: يعمل',
  soundOff: 'الصوت: مكتوم',
} as const;
