import { defineMessages } from "../types";

/** First-time Welcome before onboarding (handoff §04, B + C). Says what comes next, never that setup is done. */
export const welcome = defineMessages({
  en: {
    metaTitle: "Welcome",
    title: "Welcome to NAQAH.",
    body: "Let’s set up your camel estate and the worker who looks after it, then choose how you’d like to follow along.",
    note: "A few short steps. You can change any of it later.",
    cta: "Start setting up your estate",
    pending: "Opening setup…",
    how: "How NAQAH works",
  },
  ar: {
    metaTitle: "حيّاك الله",
    title: "حيّاك الله في ناقة.",
    body: "خلّنا نجهّز مربطك والعامل المسؤول عنه، ونضبط طريقة المتابعة اللي تناسبك.",
    note: "خطوات قصيرة، وتقدر تعدّل كل شيء بعدين.",
    cta: "ابدأ إعداد مربطك",
    pending: "جاري فتح الإعداد…",
    how: "كيف تشتغل ناقة؟",
  },
});
