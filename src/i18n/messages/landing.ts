import { defineMessages } from "../types";

/** Strings owned by the public landing page. Keep both locales in lockstep. */
export const landing = defineMessages({
  en: {
    nav: {
      how: "How it works",
      plans: "Plans",
      principles: "Principles",
      demoShort: "Live demo",
      menu: "Open navigation menu",
      menuLabel: "Page navigation",
    },
    hero: {
      title: "Peace of mind, without the busyness",
      description:
        "At day’s end, your worker calls from an ordinary phone; NAQAH, the AI voice agent, asks your questions, keeps the facts, and calls you with what matters.",
      builtFor: "For one owner, one ranch, one worker.",
      callLabel: "A live call, in the worker’s language",
      callStatus: "End-of-day report",
      worker: "Worker",
      naqah: "NAQAH",
      ordinaryPhone: "Ordinary phone · no app",
      transcript: [
        "Feed is running low — about 12 bags left, and Wadha hasn’t been eating well.",
        "You said about 12 bags of feed remain. To confirm, that amount is approximate, correct?",
        "That’s right, an estimate.",
        "And Wadha hasn’t been eating well. Should I mark her as under watch?",
        "Yes, please mark her as under watch.",
      ],
      factsTitle: "Facts kept",
      facts: {
        feedLabel: "Feed",
        feedValue: "Running low · approximate",
        camelLabel: "Wadha",
        camelValue: "Under watch · reported by worker",
        note: "Only extracted facts are kept.",
      },
    },
    how: {
      title: "From the worker’s call to a clearer view",
      description: "A simple end-of-day rhythm, built around the way your ranch already works.",
      steps: [
        {
          number: "01",
          title: "The worker calls",
          body: "From an ordinary phone, in their own language. Nothing to install.",
        },
        {
          number: "02",
          title: "NAQAH asks and records",
          body: "Your questions, one at a time. Quantities and camel names are confirmed; audio is never kept.",
        },
        {
          number: "03",
          title: "You get the call",
          body: "Only what matters. The website always shows the latest update with its exact time.",
        },
      ],
    },
    ownerCall: {
      title: "A short call, with only what matters",
      description: "When an update needs your attention, NAQAH calls with a clear summary.",
      findingLabel: "When there is something to review",
      findingQuote:
        "The farm update is in. The worker reported that feed is running low and a health note about Wadha needs review. Details are on the website.",
      quietLabel: "When there is nothing important to flag",
      quietQuote:
        "The farm update is in. Based on the worker’s latest report, there is nothing important to flag. Details are on the website.",
      listen: "Listen to the call",
      stop: "Stop listening",
    },
    capabilities: {
      title: "A steady hand behind the update",
      description: "A few careful rules keep the daily exchange useful and calm.",
      items: [
        {
          title: "Questions you choose",
          body: "Your prompts, one at a time. “I don’t know” is a valid answer.",
        },
        {
          title: "You decide what matters",
          body: "Choose which findings should reach you by call.",
        },
        {
          title: "Tasks stay open until confirmed",
          body: "On Ultimate, a task closes only after the worker explicitly confirms it.",
        },
        {
          title: "Missed-call follow-up",
          body: "Unanswered calls retry every 20 minutes, up to 3 times. Then a No Answer ticket appears.",
        },
        {
          title: "Speaks the worker’s language",
          body: "The worker uses an ordinary phone, with no app to learn.",
        },
        {
          title: "Nothing recorded",
          body: "Call audio is never kept; only extracted facts are stored.",
        },
        {
          title: "Emergencies go straight to you",
          body: "The worker calls the owner directly, outside the AI.",
        },
        {
          title: "Arabic first",
          body: "A complete Arabic experience, with English alongside it.",
        },
      ],
    },
    plans: {
      title: "Choose the rhythm that suits your ranch",
      description: "Both plans keep the same quiet, considered approach.",
      basic: {
        name: "Basic",
        summary: "A weekly rhythm, in a window you choose.",
        cta: "Try Basic in the demo",
        rows: {
          cadence: "Weekly report in your chosen window",
          questions: "Up to 5 custom questions",
          calls: "One owner call per week",
          tickets: "Task tickets not included",
        },
      },
      ultimate: {
        name: "Ultimate",
        summary: "A clear view at the end of every day.",
        featured: "Daily oversight",
        cta: "Try Ultimate in the demo",
        rows: {
          cadence: "Daily end-of-day report",
          questions: "Unlimited custom questions",
          calls: "Unlimited owner calls",
          tickets: "Task tickets close on worker confirmation, with History",
        },
      },
      rowLabels: {
        cadence: "Reporting",
        questions: "Your questions",
        calls: "Owner calls",
        tickets: "Tasks and History",
      },
      pricing: "Pricing is shared with pilot partners and will be announced at launch.",
    },
    principles: {
      title: "Trust is built into the way NAQAH works",
      description: "Clear limits. Careful records. Your attention stays yours.",
      items: [
        {
          title: "Quiet by design",
          body: "You get the important findings by call; the full report stays on the website.",
        },
        {
          title: "Facts keep their certainty",
          body: "Each fact is labeled reported, approximate, unknown, or verified.",
        },
        {
          title: "No recordings",
          body: "NAQAH keeps extracted facts, never call audio.",
        },
        {
          title: "Emergencies bypass NAQAH",
          body: "The worker calls the owner directly when something is urgent.",
        },
      ],
    },
    final: {
      title: "See how a quieter day can feel",
      body: "Explore the live demo with a sample ranch, then make it your own.",
    },
  },
  ar: {
    nav: {
      how: "كيف تعمل",
      plans: "الخطط",
      principles: "المبادئ",
      demoShort: "العرض الحي",
      menu: "فتح قائمة التنقل",
      menuLabel: "التنقل في الصفحة",
    },
    hero: {
      title: "اطمئنان، دون انشغال",
      description:
        "في نهاية اليوم، يتصل العامل من جواله المعتاد؛ وناقة، مساعدك الصوتي الذكي، تسأله أسئلتك وتحفظ المعلومات، ثم تتصل بك بما يهمك.",
      builtFor: "لصاحب واحد، وعزبة واحدة، وعامل واحد.",
      callLabel: "مكالمة مباشرة، بلغة العامل",
      callStatus: "تقرير نهاية اليوم",
      worker: "العامل",
      naqah: "ناقة",
      ordinaryPhone: "جوال عادي · بدون تطبيق",
      transcript: [
        "العلف قرب يخلص، باقي تقريباً 12 كيس، ووضحة ما تاكل زين.",
        "ذكرت إن باقي تقريباً 12 كيس علف. للتأكيد، الكمية تقديرية، صحيح؟",
        "صحيح، تقديرية.",
        "ووضحة ما تاكل زين. أسجلها على إنها تحت الملاحظة؟",
        "إيه، سجلها تحت الملاحظة.",
      ],
      factsTitle: "المعلومات المحفوظة",
      facts: {
        feedLabel: "العلف",
        feedValue: "قرب يخلص · تقديري",
        camelLabel: "وضحة",
        camelValue: "تحت الملاحظة · بحسب إفادة العامل",
        note: "نحفظ المعلومات المستخلصة فقط.",
      },
    },
    how: {
      title: "من مكالمة العامل إلى صورة أوضح للمزرعة",
      description: "متابعة بسيطة في نهاية اليوم، على طريقة العمل المعتادة في عزبك.",
      steps: [
        {
          number: "01",
          title: "العامل يتصل",
          body: "من جواله المعتاد، بلغته، بدون ما يحتاج يثبت تطبيق.",
        },
        {
          number: "02",
          title: "ناقة تسأل وتدوّن",
          body: "أسئلتك، واحدًا تلو الآخر. نتأكد من الأعداد وأسماء النوق، ولا نحفظ صوت المكالمة.",
        },
        {
          number: "03",
          title: "يصلك اتصال بالخلاصة",
          body: "نخبرك بما يهمك فقط. ويعرض الموقع آخر تحديث ووقته بدقة.",
        },
      ],
    },
    ownerCall: {
      title: "اتصال قصير، للمهم فقط",
      description: "إذا احتاج التحديث انتباهك، تتصل بك ناقة بخلاصة واضحة.",
      findingLabel: "إذا كان فيه ما يستحق المراجعة",
      findingQuote:
        "وصل تحديث الحلال. العامل أفاد أن العلف قرب يخلص، وفي ملاحظة صحية على وضحة تحتاج مراجعة. التفاصيل موجودة في الموقع.",
      quietLabel: "إذا ما فيه ملاحظات مهمة",
      quietQuote:
        "وصل تحديث الحلال، وما فيه ملاحظات مهمة بحسب آخر تقرير من العامل. التفاصيل موجودة في الموقع.",
      listen: "استمع للمكالمة",
      stop: "إيقاف الاستماع",
    },
    capabilities: {
      title: "متابعة هادئة، بقواعد واضحة",
      description: "تفاصيل بسيطة تخلي التواصل اليومي مفيدًا ومريحًا.",
      items: [
        {
          title: "أسئلتك أنت",
          body: "تختار أسئلتك، سؤالًا بعد سؤال. و«ما أدري» إجابة مقبولة.",
        },
        {
          title: "أنت تحدد المهم",
          body: "تختار الملاحظات التي تستحق اتصالًا.",
        },
        {
          title: "المهمة تبقى مفتوحة حتى يؤكد العامل",
          body: "في الخطة المتكاملة، ما تُغلق المهمة إلا بعد تأكيد العامل صراحةً.",
        },
        {
          title: "متابعة المكالمات الفائتة",
          body: "إذا ما رد العامل، يعاود الاتصال كل 20 دقيقة، حتى 3 مرات. بعدها تظهر تذكرة «لا يوجد رد».",
        },
        {
          title: "بلغة العامل",
          body: "يتحدث العامل من جواله المعتاد، بدون ما يحتاج يتعلم تطبيقًا جديدًا.",
        },
        {
          title: "بدون تسجيل",
          body: "ما نحفظ صوت المكالمة؛ نحفظ المعلومات المستخلصة فقط.",
        },
        {
          title: "الطوارئ تتصل بك مباشرة",
          body: "للطوارئ، يتصل العامل بالمالك مباشرة، خارج ناقة.",
        },
        {
          title: "العربية أولًا",
          body: "تجربة عربية متكاملة، ومعها تجربة كاملة بالإنجليزية.",
        },
      ],
    },
    plans: {
      title: "اختر الإيقاع المناسب لعزبتك",
      description: "في كلتا الخطتين، تظل المتابعة هادئة وواضحة.",
      basic: {
        name: "الأساسية",
        summary: "متابعة أسبوعية ضمن الوقت الذي تختاره.",
        cta: "جرّب الأساسية في العرض",
        rows: {
          cadence: "تقرير أسبوعي ضمن نافذتك المختارة",
          questions: "حتى 5 أسئلة خاصة",
          calls: "اتصال واحد بالمالك في الأسبوع",
          tickets: "لا تشمل تذاكر المهام",
        },
      },
      ultimate: {
        name: "المتكاملة",
        summary: "صورة أوضح في نهاية كل يوم.",
        featured: "متابعة يومية",
        cta: "جرّب المتكاملة في العرض",
        rows: {
          cadence: "تقرير يومي في نهاية الدوام",
          questions: "أسئلة خاصة بلا حد",
          calls: "اتصالات غير محدودة بالمالك",
          tickets: "تذاكر مهام لا تُغلق إلا بتأكيد العامل، مع السجل",
        },
      },
      rowLabels: {
        cadence: "التقارير",
        questions: "أسئلتك",
        calls: "اتصالات المالك",
        tickets: "المهام والسجل",
      },
      pricing: "تُشارك الأسعار مع شركاء التجربة، ويُعلن عنها عند الإطلاق.",
    },
    principles: {
      title: "الثقة جزء من طريقة عمل ناقة",
      description: "حدود واضحة، ومعلومات محفوظة بعناية، وانتباهك يبقى لك.",
      items: [
        {
          title: "الهدوء في تصميمها",
          body: "يصلك المهم باتصال، وتبقى التفاصيل كاملة في الموقع.",
        },
        {
          title: "وضوح مصدر المعلومة",
          body: "كل معلومة موضّح حالها: بحسب إفادة العامل، تقديرية، غير معروفة، أو مؤكدة.",
        },
        {
          title: "ما فيه تسجيلات",
          body: "تحفظ ناقة المعلومات المستخلصة فقط، ولا تحفظ صوت المكالمة.",
        },
        {
          title: "الطوارئ خارج ناقة",
          body: "إذا صار أمر عاجل، يتصل العامل بالمالك مباشرة.",
        },
      ],
    },
    final: {
      title: "شوف كيف تكون المتابعة أهدأ",
      body: "استكشف العرض الحي بمزرعة تجريبية، وبعدها جهّز مزرعتك.",
    },
  },
});
