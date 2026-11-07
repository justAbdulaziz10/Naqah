import { defineMessages } from "../../types";

/** Strings for the "Phone line" integration. Keep both locales in lockstep. */
export const phone = defineMessages({
  en: {
    title: "Phone line",
    checking: "Checking the phone line…",
    notConnected: "Not connected — the Call Lab simulates calls.",
    notConnectedAccount: "Not connected yet. NAQAH will call your worker once it is.",
    notConnectedShort: "Not connected",
    connected: "Connected",
    sampleLine: "This line runs the sample farm. Its calls are not saved to your farm.",
    numberMissing: "Live calling is configured, but no public number is listed yet.",
    signatureValidationOff: "Webhook signature checks are off; automatic owner summaries are paused.",
    callNow: "Call NAQAH now",
    whatsapp: "WhatsApp summary",
    ownerCall: "Owner voice summary",
  },
  ar: {
    title: "خط الاتصال",
    checking: "جارٍ التحقق من خط الاتصال…",
    notConnected: "غير متصل — مكالمات Call Lab تجريبية.",
    notConnectedAccount: "ما ارتبط بعد. ناقة بتتصل على العامل أول ما يرتبط.",
    notConnectedShort: "غير متصل",
    connected: "متصل",
    sampleLine: "هذا الخط يعمل على المزرعة النموذجية، ومكالماته لا تُحفظ في مزرعتك.",
    numberMissing: "الاتصال المباشر مجهز، لكن ما أُضيف رقم عام إلى الآن.",
    signatureValidationOff: "التحقق من توقيع المكالمات غير مفعّل، لذلك ملخصات المالك التلقائية متوقفة.",
    callNow: "اتصل بناقة الآن",
    whatsapp: "ملخص واتساب",
    ownerCall: "ملخص بمكالمة للمالك",
  },
});
