import { defineMessages } from "../types";

/** A signed-in owner's real farm. Keep both locales in lockstep. */
export const account = defineMessages({
  en: {
    loading: "Loading your ranch",
    loadFailed: "We couldn't load your ranch. Your data is safe.",
    notSaved: "Your latest change isn't saved yet.",
    refused: "Something you entered is too long or out of range. Change it and it will save.",
    planLocked: "Your plan can't be changed here yet.",
    retry: "Try again",
    dismiss: "Dismiss",
  },
  ar: {
    loading: "جارٍ تحميل مزرعتك",
    loadFailed: "ما قدرنا نحمّل مزرعتك. بياناتك بأمان.",
    notSaved: "آخر تعديل ما انحفظ إلى الآن.",
    refused: "فيه قيمة طويلة أو خارج الحد. عدّلها وبتنحفظ.",
    planLocked: "تغيير الباقة غير متاح من هنا حالياً.",
    retry: "حاول مرة ثانية",
    dismiss: "إغلاق",
  },
});
