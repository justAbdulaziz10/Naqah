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
    unsent: "Not saved: fix the marked field",
    leaveUnsaved: "Some changes on this page aren’t saved yet. Leave anyway?",
    logoutUnsavedTitle: "Some changes aren’t saved yet",
    logoutUnsaved: "If you log out now, they’ll be lost.",
    logoutRetry: "Try saving again",
    logoutStay: "Stay",
    logoutDiscard: "Discard and log out",
    logoutSaving: "Saving your changes…",
  },
  ar: {
    loading: "جارٍ تحميل عزبتك",
    loadFailed: "ما قدرنا نحمّل عزبتك. بياناتك بأمان.",
    notSaved: "آخر تعديل ما انحفظ إلى الآن.",
    refused: "فيه قيمة طويلة أو خارج الحد. عدّلها وبتنحفظ.",
    planLocked: "تغيير الباقة غير متاح من هنا حالياً.",
    retry: "حاول مرة ثانية",
    dismiss: "إغلاق",
    unsent: "ما انحفظ: صحّح الحقل المحدد",
    leaveUnsaved: "فيه تعديلات في هذي الصفحة ما انحفظت. تبي تطلع؟",
    logoutUnsavedTitle: "فيه تعديلات ما انحفظت",
    logoutUnsaved: "إذا سجّلت خروجك الحين، بتضيع.",
    logoutRetry: "جرّب الحفظ مرة ثانية",
    logoutStay: "خلّني هنا",
    logoutDiscard: "تجاهلها وسجّل خروج",
    logoutSaving: "جاري حفظ تعديلاتك…",
  },
});
