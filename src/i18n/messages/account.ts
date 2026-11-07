import { defineMessages } from "../types";

/** A signed-in owner's real farm. Keep both locales in lockstep. */
export const account = defineMessages({
  en: {
    loading: "Loading your farm",
    loadFailed: "We couldn't load your farm. Your data is safe.",
    notSaved: "Your latest change isn't saved yet.",
    refused: "Something you entered is too long or out of range. Change it and it will save.",
    planLocked: "Your plan can't be changed here yet.",
    retry: "Try again",
    dismiss: "Dismiss",
    title: "Account",
    callsReady: "Your farm details are saved. Outbound calling must be connected before NAQAH can call your worker.",
  },
  ar: {
    loading: "جارٍ تحميل مزرعتك",
    loadFailed: "ما قدرنا نحمّل مزرعتك. بياناتك بأمان.",
    notSaved: "آخر تعديل ما انحفظ إلى الآن.",
    refused: "فيه قيمة طويلة أو خارج الحد. عدّلها وبتنحفظ.",
    planLocked: "تغيير الباقة غير متاح من هنا حالياً.",
    retry: "حاول مرة ثانية",
    dismiss: "إغلاق",
    title: "الحساب",
    callsReady: "حُفظت بيانات مزرعتك. يلزم ربط المكالمات الصادرة قبل ما تتصل ناقة على العامل.",
  },
});
