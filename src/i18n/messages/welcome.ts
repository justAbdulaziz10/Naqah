import { defineMessages } from "../types";

/** First-time Welcome before onboarding (handoff §04, B + C). Says what comes next, never that setup is done. */
export const welcome = defineMessages({
  en: {
    metaTitle: "Welcome",
    title: "Welcome.",
    line: "A few steps. Change anything later.",
    stepsLabel: "What you’ll set up",
    steps: ["Plan", "Ranch", "Worker", "Calls"],
    cta: "Set up your ranch",
    pending: "Opening setup…",
    how: "How NAQAH works",
    signIn: "Sign in",
  },
  ar: {
    metaTitle: "حيّاك الله",
    title: "حيّاك الله",
    line: "خطوات قليلة، وأي شيء تقدر تعدّله بعدين.",
    stepsLabel: "اللي بتجهّزه",
    steps: ["الباقة", "عزبتك", "عاملك", "مكالماتك"],
    cta: "جهّز عزبتك",
    pending: "جاري فتح الإعداد…",
    how: "كيف تشتغل ناقة؟",
    signIn: "دخول",
  },
});
