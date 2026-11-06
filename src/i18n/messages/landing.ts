import { defineMessages } from "../types";

/** Strings owned by the public landing page. Keep both locales in lockstep. Say each fact once. */
export const landing = defineMessages({
  en: {
    nav: {
      how: "The call",
      plans: "Plans",
      signIn: "Owner sign-in",
      menu: "Open navigation menu",
      menuLabel: "Page navigation",
      skip: "Skip to content",
    },
    setUp: "Set up your ranch",
    hero: {
      title: "Peace of mind for your herd",
      line: "Your worker calls. NAQAH asks your questions, then calls you with the update.",
    },
    example: "Illustrative example",
    pending: "Opening the demo…",
    story: {
      title: "From one call to a clear picture",
      line: "No app for your worker. An ordinary phone is enough.",
    },
    call: {
      label: "Thursday’s update, Al Safra Ranch",
      worker: "Ahmed",
      naqah: "NAQAH",
      workerTitle: "Ahmed calls NAQAH",
      savedTitle: "The facts are kept",
      ownerTitle: "Then your phone rings",
      lines: [
        { who: "worker", text: "Feed is running low, about 12 bags left. And Wadha hasn’t been eating well." },
        { who: "naqah", text: "About 12 bags. Is that an estimate?" },
        { who: "worker", text: "Yes, an estimate." },
      ],
      facts: [
        { label: "Feed", value: "Running low", certainty: "approximate" },
        { label: "Wadha", value: "Not eating well", certainty: "reported by Ahmed" },
      ],
    },
    owner: {
      answer: "Answer",
      hangUp: "End call",
      review: "Something to review",
      quiet: "Nothing to flag",
      reviewQuote:
        "The farm update is in. Ahmed reports feed is running low, and Wadha needs a look. The details are on the website.",
      quietQuote: "The farm update is in. Nothing important to flag today. The details are on the website.",
      listen: "Listen",
      stop: "Stop",
    },
    heritage: {
      title: "Rooted in heritage. Clear in detail.",
      items: [
        { label: "No recordings", value: "Only the facts from the call are kept." },
        { label: "Emergencies never wait", value: "Your worker calls you directly, never through NAQAH." },
      ],
    },
    plans: {
      title: "Two plans",
      pricing: "Pricing hasn’t been set yet.",
      labels: {
        cadence: "Ranch report",
        questions: "Your own questions",
        calls: "Your calls to NAQAH",
        tickets: "Task tickets",
      },
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
      title: "Your herd, close to you",
      line: "Your ranch, your worker, your questions.",
    },
    credits: "Photography",
  },
  ar: {
    nav: {
      how: "المكالمة",
      plans: "الباقات",
      signIn: "دخول المالك",
      menu: "فتح قائمة التنقل",
      menuLabel: "التنقل في الصفحة",
      skip: "انتقل إلى المحتوى",
    },
    setUp: "جهّز عزبتك",
    hero: {
      title: "اطمئنان، دون انشغال",
      line: "عاملك يتصل، وناقة تسأله أسئلتك، ثم تتصل فيك بالخلاصة.",
    },
    example: "مثال توضيحي",
    pending: "جاري فتح العرض…",
    story: {
      title: "من مكالمة بسيطة، لصورة أوضح",
      line: "بلا تطبيق للعامل. جواله العادي يكفي.",
    },
    call: {
      label: "تحديث الخميس، عزبة الصفراء",
      worker: "أحمد",
      naqah: "ناقة",
      workerTitle: "أحمد يتصل بناقة",
      savedTitle: "تنحفظ المعلومات",
      ownerTitle: "وبعدها يرن جوالك",
      lines: [
        { who: "worker", text: "العلف قرب يخلص، باقي تقريباً 12 كيس. ووضحة ما تاكل زين." },
        { who: "naqah", text: "12 كيس تقريباً. الكمية تقديرية؟" },
        { who: "worker", text: "إيه، تقديرية." },
      ],
      facts: [
        { label: "العلف", value: "قارب على النفاد", certainty: "تقديري" },
        { label: "وضحة", value: "ما تاكل زين", certainty: "حسب إفادة أحمد" },
      ],
    },
    owner: {
      answer: "ردّ",
      hangUp: "إنهاء المكالمة",
      review: "فيه شيء يحتاج نظرة",
      quiet: "ما فيه شيء مهم",
      reviewQuote: "وصل تحديث المزرعة. أحمد يقول إن العلف قرب يخلص، ووضحة تحتاج نظرة. التفاصيل في الموقع.",
      quietQuote: "وصل تحديث المزرعة. ما فيه شيء مهم اليوم. التفاصيل في الموقع.",
      listen: "استمع",
      stop: "إيقاف",
    },
    heritage: {
      title: "أصالة في الجذور. وضوح في التفاصيل.",
      items: [
        { label: "ما فيه تسجيل", value: "تُحفظ المعلومات المستخرجة من المكالمة فقط." },
        { label: "الطوارئ ما تنتظر", value: "عاملك يتصل بك مباشرة، مو عن طريق ناقة." },
      ],
    },
    plans: {
      title: "باقتان",
      pricing: "الأسعار ما تحددت بعد.",
      labels: {
        cadence: "تقرير العزبة",
        questions: "أسئلتك الخاصة",
        calls: "اتصالاتك بناقة",
        tickets: "تذاكر المهام",
      },
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
      title: "حلالك، قريب منك",
      line: "عزبتك، وعاملك، وأسئلتك.",
    },
    credits: "التصوير",
  },
});
