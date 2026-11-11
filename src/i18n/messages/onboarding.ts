import { defineMessages } from "../types";

/** Strings shared by the setup field groups (resources, what matters, emergencies, phone field). Keep en and ar keys identical. */
export const onboarding = defineMessages({
  en: {
    sectionTitles: {
      resources: "Ranch resources",
      whatMatters: "What matters to you",
    },
    hasResource: "We have this on the ranch",
    presentOnFarm: "On the ranch",
    absentFromFarm: "Not on the ranch",
    absentResourcesSkipped: "Questions about resources you do not have are skipped.",
    criteriaTitle: "Information you want to hear about",
    customCriterion: "Custom keyword or phrase",
    removeCustomCriterion: (name: string) => `Remove ${name}`,
    emergenciesTitle: "Emergency categories",
    emergencyNote: "In an emergency, the worker calls you directly, not through NAQAH.",
    wizard: {
      phonePlaceholder: "5X XXX XXXX",
      phoneCountry: "Saudi Arabia, +966",
      phoneCheck: "Enter a Saudi mobile: 9 digits starting with 5.",
    },
    /** The setup wizard's own words: shorter than Settings, one line per step. */
    flow: {
      panelLine: "Four short steps. Everything saves as you go.",
      next: (step: string) => `Next: ${step}`,
      heads: {
        ranch: { title: "Your ranch", lead: "Its name, and the number NAQAH calls you on." },
        ranchDemo: { title: "Your ranch", lead: "Pick a plan to try, then your ranch’s name and your number." },
        team: { title: "Workers and herd", lead: "Who NAQAH calls, and what the ranch has." },
        call: { title: "When should NAQAH call?", lead: "Your worker for the report, then you with the summary." },
        ready: { title: "Your ranch is ready", lead: "Have a look. You can change anything later in Settings." },
        almost: { title: "Almost there", lead: "Open your dashboard now and finish the rest in Settings." },
      },
      finishLine: "NAQAH knows who to call, when, and what to ask.",
    },
    /** The plan cards: price first, then the week, then two facts. */
    plans: {
      title: "Choose your plan",
      lead: "You can change it later through the NAQAH team.",
      perMonth: "a month",
      currency: "SAR",
      beforeVat: "before VAT",
      withVat: (percent: number) => `with ${percent}% VAT`,
      basicRhythm: "A report and a summary, once a week",
      ultimateRhythm: "A report and a summary, every day",
      basicFacts: (questions: number, workers: number) => `Up to ${questions} of your questions · up to ${workers} workers`,
      ultimateFacts: (workers: number) => `Unlimited questions · up to ${workers} workers · your instructions become tasks`,
    },
  },
  ar: {
    sectionTitles: {
      resources: "موارد العزبة",
      whatMatters: "ما يهمك",
    },
    hasResource: "متوفر في العزبة",
    presentOnFarm: "متوفر في العزبة",
    absentFromFarm: "غير موجود في العزبة",
    absentResourcesSkipped: "نتجاوز الأسئلة عن الموارد غير الموجودة في عزبتك.",
    criteriaTitle: "المعلومات التي تهمك",
    customCriterion: "كلمة أو عبارة مخصصة",
    removeCustomCriterion: (name: string) => `حذف ${name}`,
    emergenciesTitle: "حالات الطوارئ",
    emergencyNote: "في الطوارئ، العامل يتصل فيك مباشرة، مو عن طريق ناقة.",
    wizard: {
      phonePlaceholder: "5X XXX XXXX",
      phoneCountry: "السعودية، ‎+966",
      phoneCheck: "اكتب جوال سعودي من 9 أرقام يبدأ بـ 5.",
    },
    flow: {
      panelLine: "أربع خطوات قصيرة، وكل شي ينحفظ أول بأول.",
      next: (step: string) => `التالي: ${step}`,
      heads: {
        ranch: { title: "عزبتك", lead: "اسمها، والرقم اللي تتصل عليه ناقة." },
        ranchDemo: { title: "عزبتك", lead: "اختر باقة تجرّبها، وبعدها اسم العزبة ورقمك." },
        team: { title: "العمال والحلال", lead: "مين تتصل عليه ناقة، ووش عندك في العزبة." },
        call: { title: "متى تتصل ناقة؟", lead: "على عاملك للتقرير، وبعدها عليك بالملخص." },
        ready: { title: "عزبتك جاهزة", lead: "ألقِ نظرة. تقدر تغيّر أي شي بعدين من الإعدادات." },
        almost: { title: "باقي القليل", lead: "افتح لوحتك الحين، وكمّل الباقي من الإعدادات." },
      },
      finishLine: "ناقة تعرف على مين تتصل، ومتى، ووش تسأل.",
    },
    plans: {
      title: "اختر باقتك",
      lead: "تقدر تغيّرها بعدين عن طريق فريق ناقة.",
      perMonth: "شهريًا",
      currency: "ريال",
      beforeVat: "قبل الضريبة",
      withVat: (percent: number) => `مع ضريبة ${percent}٪`,
      basicRhythm: "تقرير وملخص، مرة في الأسبوع",
      ultimateRhythm: "تقرير وملخص، كل يوم",
      basicFacts: (questions: number, workers: number) => `حتى ${questions} من أسئلتك · حتى ${workers} عمال`,
      ultimateFacts: (workers: number) => `أسئلة بلا حد · حتى ${workers} عمال · تعليماتك تصير مهام`,
    },
  },
});
