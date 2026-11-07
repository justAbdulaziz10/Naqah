import { defineMessages } from "../types";

/** Strings owned by the public landing page. Keep both locales in lockstep. Say each fact once. */
export const landing = defineMessages({
  en: {
    nav: {
      how: "The call",
      principles: "Principles",
      plans: "Plans",
      signIn: "Owner sign-in",
      menu: "Open navigation menu",
      menuLabel: "Page navigation",
      skip: "Skip to content",
    },
    hero: {
      title: "Peace of mind for your herd",
      description:
        "NAQAH calls your worker at the time you choose, asks your questions, keeps the facts, and calls you with the update.",
    },
    example: "Illustrative example",
    pending: "Opening the demo…",
    story: {
      title: "The report call",
      stages: [
        {
          lead: "At the time you choose,",
          body: "NAQAH calls your worker on their ordinary phone. No app, no forms.",
        },
        {
          lead: "Your questions, one at a time.",
          body: "NAQAH asks what you set up, confirms numbers and camel names, and accepts “I don’t know”. Each fact is saved with how sure it is.",
        },
        {
          lead: "Then NAQAH calls you.",
          body: "Right after the update is saved, with only what matters. Even on a quiet day.",
        },
      ],
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
    principles: {
      title: "What NAQAH holds to",
      lead: "Built for how a camel ranch really runs: one owner, a worker you trust, and a herd you know by name.",
      statement: "Rooted in heritage. Clear in detail.",
      items: [
        { label: "Recordings", value: "None. Only the facts from the call are kept." },
        { label: "If the worker misses a call", value: "NAQAH tries up to 3 more times, 20 minutes apart, then flags it for you." },
        { label: "Your instructions", value: "On Ultimate, a task stays open until the worker confirms it is done." },
        { label: "Emergencies", value: "They never wait for NAQAH. The worker calls you directly." },
      ],
    },
    plans: {
      title: "Choose your rhythm",
      pricing: "Pricing hasn’t been set yet.",
      labels: {
        cadence: "Farm report",
        questions: "Your own questions",
        update: "NAQAH calls you",
        calls: "Your calls to NAQAH",
        tickets: "Task tickets",
      },
      basic: {
        name: "Basic",
        summary: "Once a week, on the day and time you choose.",
        rows: { cadence: "Weekly", questions: "Up to 5", update: "After every report", calls: "One a week", tickets: "Not included" },
      },
      ultimate: {
        name: "Ultimate",
        summary: "Every day, at the time you choose.",
        rows: { cadence: "Daily", questions: "Unlimited", update: "After every report", calls: "Unlimited", tickets: "Included" },
      },
    },
    final: {
      title: "See a quieter day",
      body: "Set up your ranch in a few minutes.",
    },
    credits: "Photography",
  },
  ar: {
    nav: {
      how: "المكالمة",
      principles: "التزاماتنا",
      plans: "الخطط",
      signIn: "دخول المالك",
      menu: "فتح قائمة التنقل",
      menuLabel: "التنقل في الصفحة",
      skip: "انتقل إلى المحتوى",
    },
    hero: {
      title: "اطمئنان على حلالك",
      description:
        "ناقة تتصل على عاملك في الوقت اللي تختاره، تسأله عن اللي يهمك، تحفظ المعلومات، وتتصل عليك بملخص التحديث.",
    },
    example: "مثال توضيحي",
    pending: "جاري فتح العرض…",
    story: {
      title: "مكالمة التقرير",
      stages: [
        {
          lead: "في الوقت اللي تختاره،",
          body: "ناقة تتصل على عاملك على جواله العادي، بدون تطبيق ولا نماذج.",
        },
        {
          lead: "أسئلتك، سؤال بعد سؤال.",
          body: "ناقة تسأل اللي جهزته، وتتأكد من الأرقام وأسماء الحلال، و«ما أدري» إجابة مقبولة. وكل معلومة تنحفظ مع مدى التأكد منها.",
        },
        {
          lead: "بعدها ناقة تتصل عليك.",
          body: "أول ما ينحفظ التحديث، وتعطيك المهم بس. حتى لو كان اليوم هادي.",
        },
      ],
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
        { label: "العلف", value: "قرب يخلص", certainty: "تقديري" },
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
    principles: {
      title: "ما تلتزم به ناقة",
      lead: "مصممة للعزبة مثل ما تمشي فعلاً: مالك واحد، وعامل تثق فيه، وحلال تعرفه بالاسم.",
      statement: "أصالة في الجذور. وضوح في التفاصيل.",
      items: [
        { label: "التسجيل", value: "المكالمة ما تتسجل. ناقة تحفظ المعلومات بس." },
        { label: "إذا فاتت العامل مكالمة", value: "ناقة تعيد الاتصال حتى 3 مرات، كل 20 دقيقة، وبعدها تنبهك." },
        { label: "تعليماتك", value: "في المتكاملة، تبقى المهمة مفتوحة لين يؤكد العامل إنه خلّصها." },
        { label: "الطوارئ", value: "ما تنتظر ناقة. العامل يتصل عليك مباشرة." },
      ],
    },
    plans: {
      title: "اختر إيقاعك",
      pricing: "الأسعار ما تحددت بعد.",
      labels: {
        cadence: "تقرير المزرعة",
        questions: "أسئلتك الخاصة",
        update: "ناقة تتصل عليك",
        calls: "اتصالاتك على ناقة",
        tickets: "تذاكر المهام",
      },
      basic: {
        name: "الأساسية",
        summary: "مرة في الأسبوع، في اليوم والوقت اللي تختاره.",
        rows: { cadence: "أسبوعي", questions: "حتى 5", update: "بعد كل تقرير", calls: "مرة في الأسبوع", tickets: "غير متوفرة" },
      },
      ultimate: {
        name: "المتكاملة",
        summary: "كل يوم، في الوقت اللي تختاره.",
        rows: { cadence: "يومي", questions: "بلا حد", update: "بعد كل تقرير", calls: "بلا حد", tickets: "متوفرة" },
      },
    },
    final: {
      title: "خلّ يومك أهدأ",
      body: "جهّز مزرعتك في دقائق.",
    },
    credits: "التصوير",
  },
});
