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

  effectsOn: 'المؤثرات: تعمل',
  effectsOff: 'المؤثرات: مكتومة',
  percussionOn: 'الإيقاع: يعمل',
  percussionOff: 'الإيقاع: مكتوم',

  // Ranked play (step 2: verified by the server).
  offlinePractice: 'بدون اتصال: جولة تدريب',
  verifying: 'جارٍ التحقق…',
  verified: 'تم التحقق من النتيجة ✓',
  rejected: 'لم تُحتسب الجولة',
  queued: 'سنرسل نتيجتك عند الاتصال',
  leaderboard: 'المتصدرون',
  impactTotal: 'مجموع نقاط الأثر',
  myRank: (rank: number, score: number) => `ترتيبك: ${rank} · أفضل نتيجة: ${score}`,
  boardEmpty: 'لا توجد نتائج بعد',
  boardOffline: 'تحتاج اتصالًا لعرض المتصدرين',
  back: 'رجوع',
  chooseName: 'اختر اسمك',
  nameHint: 'يظهر اسمك ورقمه في قائمة المتصدرين',
  myName: (name: string) => `اسمك: ${name}`,
  /** Fixed list, ids 1–24 in this order (= public.nicknames in supabase/migrations). */
  nicknames: [
    'وردة', 'زهرة', 'ياسمينة', 'نرجسة', 'خزامى', 'بنفسجة',
    'سوسنة', 'أقحوانة', 'نخلة', 'غيمة', 'نجمة', 'هلال',
    'بذرة', 'ثمرة', 'غصن', 'ورقة', 'ندى', 'نسمة',
    'قطرة', 'ريشة', 'جناح', 'عصفور', 'حمامة', 'بلبل',
  ] as readonly string[],
} as const;
