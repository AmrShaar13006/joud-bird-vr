# دليل المتطوعين — Joud Bird VR

ركن DSC في «طلعتنا اليوم» · جامعة اليمامة × جمعية جود
اللعبة: العصفورة جود تطير بين الصناديق. اللاعب جالس، يضغط الزناد عشان تطير.
نسخة للطباعة بصفحة واحدة: `docs/runbook-print.html`

---

## 1. الروابط

| ماذا | الرابط |
|---|---|
| اللعبة (الأساسي) | `https://joud-bird-vr.vercel.app/` |
| النسخة الاحتياطية | `https://joud-bird-vr.vercel.app/fallback.html` |

إضافات للطوارئ (تُكتب في آخر الرابط):

| متى | أضف | مثال |
|---|---|---|
| اللعبة تتقطع أو بطيئة | `?fx=0` | `joud-bird-vr.vercel.app/?fx=0` |
| العصفورة ما ظهرت | `?model=placeholder` | `joud-bird-vr.vercel.app/?model=placeholder` |
| للأطفال (يبدأ على سهل) | `?mode=easy` | `joud-bird-vr.vercel.app/?mode=easy` |
| أكثر من إضافة | اربطها بـ `&` | `joud-bird-vr.vercel.app/?mode=easy&fx=0` |

- النسخة الاحتياطية ما فيها أزرار المستوى ولا زر الصوت: استخدم `fallback.html?mode=easy`.
- احفظ الروابط كلها كمفضلة في متصفح Quest قبل الافتتاح.

---

## 2. التجهيز قبل 16:00

- [ ] النظارة مشحونة ومتصلة بالباور بانك (24 واط أو أكثر، USB-C PD).
- [ ] اليدين (الكنترولر) شغالة + بطاريات AA احتياط.
- [ ] كرسي ثابت **بدون عجلات**.
- [ ] حدود Quest: «ثابتة / جالس» (Stationary).
- [ ] الروابط محفوظة كمفضلة (الأساسي + الاحتياطي).
- [ ] هوتسبوت الجوال جاهز كبديل للإنترنت.
- [ ] متصفح Quest مفتوح على اللعبة، وزر «ادخل الواقع الافتراضي» ظاهر.
- [ ] مناديل تعقيم + قطعة مايكروفايبر جافة للعدسات.
- [ ] جرّب جولة كاملة بنفسك.

---

## 3. لكل زائر

1. رحّب: «أهلًا! هذي لعبة العصفورة جود، تطير بين الصناديق. تبي تجرب؟»
2. اختر المستوى معه:
   - **سهل**: للأطفال ولأول مرة.
   - **عادي**: للأغلب.
   - **صعب**: لمن جرّب قبل.
   - (وجّه شعاع اليد على الزر واضغط الزناد.)
3. أجلسه على الكرسي.
4. لبّسه النظارة، وثبّت الأحزمة حتى تصير الصورة واضحة.
5. اطلب منه ينظر للأمام، ثم اضغط **إعادة التوسيط** (الشاشة تجي قدامه).
6. اشرح: «اضغط الزناد عشان تطير.»
7. جولتين تقريبًا، **3 دقايق كحد أقصى**.
8. شيل النظارة عنه بهدوء.
9. امسح الإسفنجة واليدين بمنديل تعقيم.
   العدسات: مايكروفايبر **جافة** فقط.
10. رجّع اللعبة لشاشة البداية للزائر التالي.

أزرار مفيدة داخل اللعبة:

| الزر | يسوي |
|---|---|
| الزناد | طيران / بدء / لعب مجددًا |
| A أو X | لعب مجددًا |
| B أو Y | إيقاف مؤقت |
| الصوت: يعمل / مكتوم | تشغيل أو كتم الصوت (في شاشة البداية) |

---

## 4. السلامة

- [ ] اللعب **جالس فقط**.
- [ ] المكان حول الكرسي فاضي (لا شنط، لا أسلاك، لا ناس قريبين).
- [ ] **وقّف فورًا** إذا أحد حس بدوخة أو تعب أو إزعاج، وشيل النظارة.
- [ ] العمر: حسب إرشادات Meta، **10 سنوات فأكثر**.
- [ ] متطوع يبقى **جنب اللاعب طول الوقت**.
- [ ] لا تترك النظارة تحت الشمس (الشمس تحرق الشاشة عبر العدسات).

---

## 5. حل المشاكل

| المشكلة | الحل |
|---|---|
| شاشة سوداء | تأكد إن النظارة على الوجه. اضغط زر Meta. إذا ما تغيّر: حدّث الصفحة وادخل مرة ثانية. |
| اللعبة واقفة / متجمدة | حدّث الصفحة. إذا تكررت: افتح `fallback.html`. |
| اليد ما تستجيب | اضغط أي زر عشان تصحى. إذا ما اشتغلت: غيّر البطارية. |
| الشاشة في مكان غلط | اضغط **إعادة التوسيط**. في النسخة الاحتياطية: اخرج وادخل الواقع الافتراضي مرة ثانية. |
| تتقطع أو النظارة حارة | افتح الرابط مع `?fx=0`. ريّح النظارة 5–10 دقايق بين الزوار. |
| العصفورة ما ظهرت | افتح الرابط مع `?model=placeholder`. |
| ما فيه إنترنت | شغّل هوتسبوت الجوال واتصل فيه من النظارة. |
| البطارية ضعيفة | تأكد إن الباور بانك متصل وشغّال. |
| ما فيه صوت | تأكد إن زر الصوت «يعمل»، وارفع صوت النظارة. |
| كل شي خربان | افتح الرابط على لابتوب أو شاشة TV والعب بالكيبورد (المسافة للطيران) عشان الركن يبقى شغّال. |

---

## 6. الإغلاق

- [ ] اخرج من الواقع الافتراضي (زر Meta ← خروج).
- [ ] اشحن النظارة واليدين والباور بانك.
- [ ] نظّف كل شي بمناديل التعقيم.
- [ ] اكتب أي مشكلة صارت (الوقت + وش صار) وأرسلها لعمرو للإصلاح الصباحي.

---

## English summary

Operator runbook for the Joud Bird VR booth (seated Flappy-style game, Quest 3, Quest Browser).

- **Links:** game `https://joud-bird-vr.vercel.app/`, backup `/fallback.html`. Emergency flags:
  `?fx=0` (lag/heat), `?model=placeholder` (bird missing), `?mode=easy` (kids); combine with `&`.
  The fallback has no mode or mute buttons: use `fallback.html?mode=easy`.
- **Before 16:00:** headset charged and on a 24 W+ USB-C PD power bank, controllers plus spare AA
  batteries, chair without wheels, stationary seated boundary, bookmarks saved, phone hotspot
  ready, Quest Browser open on the game, wipes and a dry microfibre cloth.
- **Per visitor:** welcome, pick the mode together (easy for kids and first-timers), seat, fit,
  recentre, "pull the trigger to fly", about 2 rounds or 3 minutes max, headset off, wipe, reset.
- **Safety:** seated only, clear area, stop at once if anyone feels unwell, Meta age guidance 10+,
  a volunteer stays beside the player, no direct sunlight on the lenses.
- **Troubleshooting:** reload, then `/fallback.html`; recentre; `?fx=0`; hotspot; power bank;
  last resort: desktop mode on a laptop or TV (Space to fly).
- **Closing:** exit VR, charge everything, write down problems for the morning fix window.
