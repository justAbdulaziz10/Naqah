import { defineMessages } from "../types";

/** First-time Welcome before onboarding (handoff §04, B + C). Says what comes next, never that setup is done. */
export const welcome = defineMessages({
  en: {
    metaTitle: "Welcome",
    title: "Welcome to NAQAH.",
    body: "Set up your estate, add your worker and choose a reporting rhythm.",
    note: "Change any detail later.",
    cta: "Set up your estate",
    pending: "Opening setup…",
    how: "How NAQAH works",
    signIn: "Sign in",
  },
  ar: {
    metaTitle: "حيّاك الله",
    title: "حيّاك الله في ناقة.",
    body: "جهّز مربطك، أضف العامل، واختر إيقاع التحديث.",
    note: "تقدر تعدّل التفاصيل لاحقًا.",
    cta: "ابدأ إعداد مربطك",
    pending: "جاري فتح الإعداد…",
    how: "كيف تشتغل ناقة؟",
    signIn: "دخول",
  },
});
