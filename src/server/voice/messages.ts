import { defineMessages } from "@/i18n/types";

/** Spoken webhook copy, kept byte-for-byte from the existing TwiML responses. */
export const voiceMessages = defineMessages({
  en: {
    lineNotConfigured: "The phone line is not configured yet.",
    unregisteredCaller: "This number is not registered with NAQAH.",
    missOnce: "Sorry, I didn't catch that. ",
    missAgain: "Sorry, I still didn't catch that. Let's try once more. ",
    missedTwice: "I couldn't understand your answer. Please call again. Thank you.",
  },
  ar: {
    lineNotConfigured: "خط الاتصال مو مفعّل حالياً.",
    unregisteredCaller: "هذا الرقم مو مسجل عند ناقة.",
    missOnce: "معليش، ما وضحت لي الإجابة. ",
    missAgain: "معليش، باقي ما وصلتني. نعيد السؤال مرة أخيرة. ",
    missedTwice: "ما قدرت أفهم إجابتك. تقدر تتصل مرة ثانية، يعطيك العافية.",
  },
});
