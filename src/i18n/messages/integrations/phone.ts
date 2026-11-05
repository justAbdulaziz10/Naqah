import { defineMessages } from "../../types";

/** Strings for the "Phone line" integration. Keep both locales in lockstep. */
export const phone = defineMessages({
  en: {
    title: "Phone line",
    checking: "Checking the phone line…",
    notConnected: "Not connected — the Call Lab simulates calls.",
    notConnectedShort: "Not connected",
    connected: "Connected",
    numberMissing: "Live calling is configured, but no public number is listed yet.",
    callNow: "Call NAQAH now",
    whatsapp: "WhatsApp summary",
    ownerCall: "Owner voice summary",
  },
  ar: {
    title: "خط الاتصال",
    checking: "جارٍ التحقق من خط الاتصال…",
    notConnected: "غير متصل — مكالمات Call Lab تجريبية.",
    notConnectedShort: "غير متصل",
    connected: "متصل",
    numberMissing: "الاتصال المباشر مجهز، لكن ما أُضيف رقم عام إلى الآن.",
    callNow: "اتصل بناقة الآن",
    whatsapp: "ملخص واتساب",
    ownerCall: "ملخص بمكالمة للمالك",
  },
});
