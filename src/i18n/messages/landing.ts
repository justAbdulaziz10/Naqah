import { defineMessages } from "../types";

/** Strings owned by the public landing page. Keep both locales in lockstep. Say each fact once. */
export const landing = defineMessages({
  en: {
    nav: {
      how: "The call",
      principles: "Principles",
      colours: "Colours",
      plans: "Plans",
      signIn: "Owner sign-in",
      menu: "Open navigation menu",
      menuLabel: "Page navigation",
      skip: "Skip to content",
    },
    hero: {
      title: "Peace of mind, without the busyness",
      description:
        "At the end of the workday your worker calls NAQAH from an ordinary phone. NAQAH asks your questions, keeps the facts, and calls you with what matters.",
    },
    example: "Illustrative example",
    intro: { skip: "Skip intro" },
    journey: {
      title: "Close to your herd",
      body: "Stay close to your camels without following every detail yourself.",
    },
    pending: "Opening the demo…",
    story: {
      title: "One call at the end of the day",
      stages: [
        {
          lead: "When the workday ends,",
          body: "your worker calls NAQAH from an ordinary phone. No app and no forms. On Ultimate that is every day; on Basic, once a week in the window you set.",
        },
        {
          lead: "Your questions, one at a time.",
          body: "NAQAH asks what you set up, confirms numbers and camel names, and accepts “I don’t know”. Each fact is saved with how sure it is.",
        },
        {
          lead: "Then NAQAH calls you.",
          body: "Right after the update is saved, even when there is nothing to flag. The details wait for you on the website.",
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
      lead: "Built for the camel estate as it is really run: one owner, one worker, and a herd you know by name.",
      statement: "Rooted in heritage. Clear in detail.",
      items: [
        { label: "Recordings", value: "None. Only the facts drawn from the call are kept." },
        { label: "If the worker misses a call", value: "NAQAH tries three more times, 20 minutes apart, then opens a No Answer ticket." },
        { label: "Your instructions", value: "On Ultimate, a task stays open until the worker confirms it is done." },
        { label: "Emergencies", value: "They never wait for NAQAH. The worker calls you directly." },
      ],
    },
    colours: {
      title: "The colours of the herd",
      lead: "The six colour classes judged at the King Abdulaziz Camel Festival, from white Wadh to dark Majaheem.",
      items: [
        { id: "wadh", name: "Wadh", native: "الوضح", description: "Bright white coats, the palest of the light-coloured camels." },
        { id: "shul", name: "Shu'l", native: "الشعل", description: "A warm light tan, between red and blond." },
        { id: "sufr", name: "Sufr", native: "الصفر", description: "Sandy yellow to beige coats." },
        { id: "shaqh", name: "Shaqh", native: "الشقح", description: "Off-white coats, a little darker than Wadh." },
        { id: "humr", name: "Humr", native: "الحمر", description: "Red to reddish-brown coats." },
        { id: "majaheem", name: "Majaheem", native: "المجاهيم", description: "Dark black coats, sometimes with a faint reddish tint." },
      ],
    },
    plans: {
      title: "Two rhythms",
      pricing: "Pricing is shared with pilot partners and announced at launch.",
      labels: {
        cadence: "Farm report",
        questions: "Your own questions",
        update: "NAQAH calls you",
        calls: "Your calls to NAQAH",
        tickets: "Task tickets",
      },
      basic: {
        name: "Basic",
        summary: "Once a week, in a window you choose.",
        cta: "Try Basic",
        rows: { cadence: "Weekly", questions: "Up to 5", update: "After every report", calls: "One a week", tickets: "Not included" },
      },
      ultimate: {
        name: "Ultimate",
        summary: "Every day, at the end of the workday.",
        cta: "Try Ultimate",
        rows: { cadence: "Daily", questions: "Unlimited", update: "After every report", calls: "Unlimited", tickets: "Open until confirmed" },
      },
    },
    final: {
      title: "See a quieter day",
      body: "A sample ranch is ready. Make it yours after.",
    },
    credits: "Photography",
  },
  ar: {
    nav: {
      how: "المكالمة",
      principles: "التزاماتنا",
      colours: "الألوان",
      plans: "الخطط",
      signIn: "دخول المالك",
      menu: "فتح قائمة التنقل",
      menuLabel: "التنقل في الصفحة",
      skip: "انتقل إلى المحتوى",
    },
    hero: {
      title: "اطمئنان، دون انشغال",
      description:
        "في نهاية الدوام يتصل العامل بناقة من جواله العادي. ناقة تسأله أسئلتك، وتحفظ المعلومات، وتتصل بك بالمهم.",
    },
    example: "مثال توضيحي",
    intro: { skip: "تخطّي" },
    journey: {
      title: "قريب من حلالك",
      body: "تبقى قريب من حلالك، دون ما تتابع كل التفاصيل بنفسك.",
    },
    pending: "جاري فتح العرض…",
    story: {
      title: "مكالمة واحدة في آخر اليوم",
      stages: [
        {
          lead: "إذا خلص الدوام،",
          body: "يتصل العامل بناقة من جواله العادي. بدون تطبيق ولا نماذج. في المتكاملة كل يوم، وفي الأساسية مرة في الأسبوع ضمن الوقت اللي تحدده.",
        },
        {
          lead: "أسئلتك، سؤال بعد سؤال.",
          body: "ناقة تسأل اللي جهزته، وتتأكد من الأرقام وأسماء الحلال، و«ما أدري» إجابة مقبولة. وكل معلومة تنحفظ مع مدى التأكد منها.",
        },
        {
          lead: "بعدها ناقة تتصل فيك.",
          body: "مباشرة بعد حفظ التحديث، حتى لو ما فيه شيء مهم. والتفاصيل تنتظرك في الموقع.",
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
    principles: {
      title: "ما تلتزم به ناقة",
      lead: "مصممة للعزبة كما تُدار فعلاً: مالك واحد، وعامل واحد، وحلال تعرفه بالاسم.",
      statement: "أصالة في الجذور. وضوح في التفاصيل.",
      items: [
        { label: "التسجيل", value: "ما فيه تسجيل. تُحفظ المعلومات المستخرجة من المكالمة فقط." },
        { label: "إذا فاتت العامل مكالمة", value: "تعيد ناقة المحاولة ثلاث مرات، بين كل وحدة 20 دقيقة، ثم تفتح تذكرة عدم رد." },
        { label: "تعليماتك", value: "في المتكاملة، تبقى المهمة مفتوحة حتى يؤكد العامل إنه أنجزها." },
        { label: "الطوارئ", value: "ما تنتظر ناقة. العامل يتصل بك مباشرة." },
      ],
    },
    colours: {
      title: "ألوان الإبل",
      lead: "الألوان الستة اللي تُحكَّم في مهرجان الملك عبدالعزيز للإبل، من الوضح البيض إلى المجاهيم السود.",
      items: [
        { id: "wadh", name: "الوضح", native: "", description: "وبرها أبيض ناصع، وهي أفتح المغاتير لوناً." },
        { id: "shul", name: "الشعل", native: "", description: "لونها بين الأحمر والأشقر، قريب من الحنطي." },
        { id: "sufr", name: "الصفر", native: "", description: "لونها أصفر رملي يميل للبيج." },
        { id: "shaqh", name: "الشقح", native: "", description: "بياضها أقل من الوضح، ويميل للغبرة." },
        { id: "humr", name: "الحمر", native: "", description: "وبرها يميل للحمرة أو البني." },
        { id: "majaheem", name: "المجاهيم", native: "", description: "لونها أسود داكن، وأحياناً فيه حمرة خفيفة." },
      ],
    },
    plans: {
      title: "إيقاعان",
      pricing: "الأسعار تُشارك مع شركاء التجربة وتُعلن عند الإطلاق.",
      labels: {
        cadence: "تقرير المزرعة",
        questions: "أسئلتك الخاصة",
        update: "ناقة تتصل فيك",
        calls: "اتصالاتك بناقة",
        tickets: "تذاكر المهام",
      },
      basic: {
        name: "الأساسية",
        summary: "مرة في الأسبوع، في وقت تختاره.",
        cta: "جرّب الأساسية",
        rows: { cadence: "أسبوعي", questions: "حتى 5", update: "بعد كل تقرير", calls: "مرة في الأسبوع", tickets: "غير متاحة" },
      },
      ultimate: {
        name: "المتكاملة",
        summary: "كل يوم، في نهاية دوام العامل.",
        cta: "جرّب المتكاملة",
        rows: { cadence: "يومي", questions: "بلا حد", update: "بعد كل تقرير", calls: "بلا حد", tickets: "مفتوحة حتى التأكيد" },
      },
    },
    final: {
      title: "شوف يوماً أهدأ",
      body: "عزبة نموذجية جاهزة. وبعدها خلّها عزبتك.",
    },
    credits: "التصوير",
  },
});
