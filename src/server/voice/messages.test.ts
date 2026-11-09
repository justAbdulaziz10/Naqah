import { describe, expect, it } from "vitest";
import { voiceMessages } from "./messages";

describe("voice webhook messages", () => {
  it("keeps Arabic and English message keys in parity", () => {
    expect(Object.keys(voiceMessages.ar).sort()).toEqual(Object.keys(voiceMessages.en).sort());
  });

  it("preserves the existing spoken webhook copy", () => {
    expect({ ar: voiceMessages.ar.lineNotConfigured, en: voiceMessages.en.lineNotConfigured }).toEqual({ ar: "خط الاتصال غير مفعّل حالياً.", en: "The phone line is not configured yet." });
    expect({ ar: voiceMessages.ar.unregisteredCaller, en: voiceMessages.en.unregisteredCaller }).toEqual({ ar: "هذا الرقم غير مسجل لدى ناقة.", en: "This number is not registered with NAQAH." });
    expect({ ar: voiceMessages.ar.missOnce, en: voiceMessages.en.missOnce }).toEqual({ ar: "معليش، ما فهمت عليك. ", en: "Sorry, I didn't catch that. " });
    expect({ ar: voiceMessages.ar.missAgain, en: voiceMessages.en.missAgain }).toEqual({ ar: "معليش، ما وصلتني الإجابة. نعيد السؤال مرة أخيرة. ", en: "Sorry, I still didn't catch that. Let's try once more. " });
    expect({ ar: voiceMessages.ar.missedTwice, en: voiceMessages.en.missedTwice }).toEqual({ ar: "ما قدرت أفهم إجابتك. تقدر تتصل مرة ثانية، يعطيك العافية.", en: "I couldn't understand your answer. Please call again. Thank you." });
  });
});
