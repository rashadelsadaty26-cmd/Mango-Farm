صوت المزرعة (اختياري) — Farm ambience (optional)
================================================

ضع تسجيلك الخاص هنا بهذا الاسم بالضبط:

    public/audio/farm-ambience.mp3

(يُخدَّم من الموقع على المسار  /audio/farm-ambience.mp3)

* الصيغة: MP3 (تعمل على كل المتصفحات وعلى iPhone Safari).
* الأفضل: مقطع من دقيقة إلى 3 دقائق، حجمه أقل من 8 ميجابايت، ونهايته تتصل ببدايته
  بسلاسة (يتكرر بلا فجوة). التطبيق يكرر المقطع بدقة عينة-بعينة، فلا يظهر أي انقطاع
  إن كان المقطع نفسه متصل الحواف.
* ملفات أكبر من ~24 ميجابايت تُشغَّل بالبث (قد تظهر فجوة صغيرة عند التكرار).
* بعد وضع الملف: أعد بناء التطبيق (npm run build) أو انشره من جديد.

لا يوجد ملف صوت في المشروع عمداً: التطبيق لا يولّد ولا يحمّل أي صوت بديل.
إن لم يوجد الملف يعمل التطبيق بشكل طبيعي ويعرض في إعدادات الصوت:
«ملف صوت المزرعة غير موجود بعد».

Place your own recording at  public/audio/farm-ambience.mp3  (MP3, ideally a 1-3 minute
seamless loop under 8 MB), then rebuild / redeploy. Nothing is generated or downloaded.

تنبيه (ويندوز): إن كانت امتدادات الملفات مخفية فقد يصبح الاسم farm-ambience.mp3.mp3 أو farm-ambience.mp3.MP3 دون أن تلاحظ.
فعّل «إظهار امتدادات الملفات» وتأكد أن الاسم النهائي هو farm-ambience.mp3 فقط، وأن حجمه بالميجابايت (وليس بضعة بايتات).
Windows: with file extensions hidden, a double extension (farm-ambience.mp3.MP3) is easy to create. The name must be exactly farm-ambience.mp3.
