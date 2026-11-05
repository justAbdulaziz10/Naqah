import { defineMessages } from "../types";

/** Strings owned by the public landing page. Keep both locales in lockstep. Say each fact once. */
export const landing = defineMessages({
  en: {
    nav: {
      how: "The call",
      plans: "Plans",
      menu: "Open navigation menu",
      menuLabel: "Page navigation",
    },
    hero: {
      title: "Peace of mind, without the busyness",
      description:
        "At the end of the day your worker calls NAQAH from an ordinary phone, in his own language. NAQAH asks your questions, keeps the facts, and calls you only with what matters.",
    },
    call: {
      label: "Thursday’s update, Al Safra Ranch",
      worker: "Ahmed",
      naqah: "NAQAH",
      saved: "Saved",
      next: "Calling Abdullah",
      lines: [
        { time: "17:42", who: "worker", text: "Feed is running low, about 12 bags left. And Wadha hasn’t been eating well." },
        { time: "17:42", who: "naqah", text: "About 12 bags. Is that an estimate?" },
        { time: "17:43", who: "worker", text: "Yes, an estimate." },
        { time: "17:43", who: "naqah", text: "Should I mark Wadha as under watch?" },
        { time: "17:43", who: "worker", text: "Yes, please." },
      ],
      facts: [
        { label: "Feed", value: "Running low", certainty: "approximate" },
        { label: "Wadha", value: "Under watch", certainty: "reported by Ahmed" },
      ],
    },
    owner: {
      title: "The call you get",
      review: "Something to review",
      quiet: "Nothing to flag",
      reviewQuote:
        "The farm update is in. Ahmed reports feed is running low, and Wadha needs a look. The details are on the website.",
      quietQuote: "The farm update is in. Nothing important to flag today. The details are on the website.",
      listen: "Listen",
      stop: "Stop",
    },
    rules: {
      title: "Rules NAQAH keeps",
      items: [
        { title: "Your questions, one at a time", body: "“I don’t know” is a valid answer. Nothing is guessed." },
        { title: "Every fact says how sure it is", body: "Reported, approximate, unknown or verified, with the time it was said." },
        { title: "Nothing is recorded", body: "No call audio is kept. Only the facts drawn from it." },
        { title: "Missed calls are followed up", body: "Three retries, 20 minutes apart. Then a No Answer ticket opens." },
        { title: "Tasks close when the worker confirms", body: "On Ultimate, your instructions stay open until he says they are done." },
        { title: "Emergencies never wait for NAQAH", body: "The worker calls you directly." },
      ],
    },
    plans: {
      title: "Two rhythms",
      pricing: "Pricing is shared with pilot partners and announced at launch.",
      labels: { cadence: "Report", questions: "Your questions", calls: "Your calls", tickets: "Task tickets" },
      basic: {
        name: "Basic",
        summary: "Once a week, in a window you choose.",
        cta: "Try Basic",
        rows: { cadence: "Weekly", questions: "Up to 5", calls: "One a week", tickets: "Not included" },
      },
      ultimate: {
        name: "Ultimate",
        summary: "Every day, at the end of the workday.",
        cta: "Try Ultimate",
        rows: { cadence: "Daily", questions: "Unlimited", calls: "Unlimited", tickets: "Open until confirmed" },
      },
    },
    final: {
      title: "See a quieter day",
      body: "A sample ranch is ready. Make it yours after.",
    },
  },
  ar: {
    nav: {
      how: "المكالمة",
      plans: "الخطط",
      menu: "فتح قائمة التنقل",
      menuLabel: "التنقل في الصفحة",
    },
    hero: {
      title: "اطمئنان، دون انشغال",
      description:
        "في نهاية اليوم يتصل العامل بناقة من جواله العادي، وبلغته. ناقة تسأله أسئلتك، وتحفظ المعلومات، وتتصل بك بالمهم فقط.",
    },
    call: {
      label: "تحديث الخميس، عزبة الصفراء",
      worker: "أحمد",
      naqah: "ناقة",
      saved: "حُفظ",
      next: "الاتصال بعبدالله",
      lines: [
        { time: "17:42", who: "worker", text: "العلف قرب يخلص، باقي تقريباً 12 كيس. ووضحة ما تاكل زين." },
        { time: "17:42", who: "naqah", text: "12 كيس تقريباً. الكمية تقديرية؟" },
        { time: "17:43", who: "worker", text: "إيه، تقديرية." },
        { time: "17:43", who: "naqah", text: "أسجّل وضحة تحت الملاحظة؟" },
        { time: "17:43", who: "worker", text: "إيه، سجّلها." },
      ],
      facts: [
        { label: "العلف", value: "قارب على النفاد", certainty: "تقديري" },
        { label: "وضحة", value: "تحت الملاحظة", certainty: "حسب إفادة أحمد" },
      ],
    },
    owner: {
      title: "الاتصال اللي يوصلك",
      review: "فيه شيء يحتاج نظرة",
      quiet: "ما فيه شيء مهم",
      reviewQuote: "وصل تحديث المزرعة. أحمد يقول إن العلف قرب يخلص، ووضحة تحتاج نظرة. التفاصيل في الموقع.",
      quietQuote: "وصل تحديث المزرعة. ما فيه شيء مهم اليوم. التفاصيل في الموقع.",
      listen: "استمع",
      stop: "إيقاف",
    },
    rules: {
      title: "قواعد تلتزم بها ناقة",
      items: [
        { title: "أسئلتك، سؤال بعد سؤال", body: "«ما أدري» إجابة مقبولة. ما فيه تخمين." },
        { title: "كل معلومة توضّح مصدرها", body: "حسب الإفادة، تقديرية، غير معروفة، أو مؤكدة، مع وقت قولها." },
        { title: "ما فيه تسجيل", body: "ما يُحفظ صوت المكالمة. تُحفظ المعلومات فقط." },
        { title: "المكالمة الفائتة لها متابعة", body: "ثلاث محاولات، بين كل وحدة 20 دقيقة. بعدها تُفتح تذكرة عدم رد." },
        { title: "المهمة ما تُقفل إلا بتأكيد العامل", body: "في المتكاملة، تبقى تعليماتك مفتوحة حتى يقول إنه أنجزها." },
        { title: "الطوارئ ما تنتظر ناقة", body: "العامل يتصل بك مباشرة." },
      ],
    },
    plans: {
      title: "إيقاعان",
      pricing: "الأسعار تُشارك مع شركاء التجربة وتُعلن عند الإطلاق.",
      labels: { cadence: "التقرير", questions: "أسئلتك", calls: "اتصالاتك", tickets: "تذاكر المهام" },
      basic: {
        name: "الأساسية",
        summary: "مرة في الأسبوع، في وقت تختاره.",
        cta: "جرّب الأساسية",
        rows: { cadence: "أسبوعي", questions: "حتى 5", calls: "مرة في الأسبوع", tickets: "غير متاحة" },
      },
      ultimate: {
        name: "المتكاملة",
        summary: "كل يوم، في نهاية دوام العامل.",
        cta: "جرّب المتكاملة",
        rows: { cadence: "يومي", questions: "بلا حد", calls: "بلا حد", tickets: "مفتوحة حتى التأكيد" },
      },
    },
    final: {
      title: "شوف يوماً أهدأ",
      body: "عزبة نموذجية جاهزة. وبعدها خلّها عزبتك.",
    },
  },
});
