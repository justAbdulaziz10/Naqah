import { defineMessages } from "../../types";

/** Strings for the "Phone line" integration. Keep both locales in lockstep. */
export const phone = defineMessages({
  en: {
    title: "Phone line",
    checking: "Checking…",
    notConnected: "Not connected. In this demo, calls run in the Call Lab.",
    notConnectedAccount: "Not connected yet. Once it is, NAQAH calls your worker at the report time.",
    notConnectedShort: "Not connected yet",
    connected: "Connected",
    sampleShort: "Sample line",
    almostReady: "Almost ready",
    sampleLine: "This is a sample line. Calls to it don’t change your farm.",
    numberMissing: "The number to call NAQAH will show here once it’s ready.",
    signatureValidationOff: "Update calls to you are paused for now.",
    callNow: "Call NAQAH",
    ownerCall: "NAQAH calls you after each update.",
    whatsapp: "You also get a WhatsApp summary.",
  },
  ar: {
    title: "خط الاتصال",
    checking: "لحظة…",
    notConnected: "غير مرتبط. في العرض التجريبي، المكالمات تصير في مختبر المكالمات.",
    notConnectedAccount: "ما ارتبط للحين. أول ما يرتبط، ناقة تتصل على العامل في وقت التقرير.",
    notConnectedShort: "ما ارتبط للحين",
    connected: "مرتبط",
    sampleShort: "خط تجريبي",
    almostReady: "قرّبنا",
    sampleLine: "هذا خط تجريبي، ومكالماته ما تغيّر شي في مزرعتك.",
    numberMissing: "رقم الاتصال على ناقة بيظهر هنا أول ما يجهز.",
    signatureValidationOff: "مكالمات التحديث لك متوقفة مؤقتًا.",
    callNow: "اتصل على ناقة",
    ownerCall: "ناقة تتصل عليك بعد كل تحديث.",
    whatsapp: "ويوصلك ملخص على واتساب بعد.",
  },
});
