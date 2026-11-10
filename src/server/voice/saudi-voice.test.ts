import { afterEach, describe, expect, it, vi } from "vitest";
import { PREDEFINED_QUESTIONS } from "@/domain/catalog";
import { HERD_COUNT_QUESTION } from "@/domain/conversation/shared";
import { REALTIME_VOICE, verbatimSpeechInstructions } from "../../../services/voice-bridge/speech.mjs";
import { arabicSayLanguage, sayElement, twimlGoodbye } from "./twiml";

describe("Saudi voice delivery", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reads the server's Arabic verbatim and only steers the accent", () => {
    const line = "هلا يا أحمد، معك ناقة، المساعد الآلي للعزبة. بأخذ منك تحديث اليوم.";
    const instructions = verbatimSpeechInstructions(line);
    expect(instructions.startsWith("Say only the following text verbatim, with no additions or omissions.")).toBe(true);
    expect(instructions).toContain("natural Saudi accent with a light Najdi influence");
    expect(instructions).toContain("Do not use a news-anchor Modern Standard Arabic delivery");
    expect(instructions).toContain(JSON.stringify(line));
    expect(instructions).not.toContain("invent");
    expect(REALTIME_VOICE).toBe("marin");
  });

  it("asks in Saudi Arabic without changing question ids or the English wording", () => {
    const water = PREDEFINED_QUESTIONS.find((question) => question.id === "water_level");
    const health = PREDEFINED_QUESTIONS.find((question) => question.id === "herd_health");
    expect(water?.text).toEqual({ ar: "وش وضع الموية عندكم؟", en: "How is the water?" });
    expect(health?.text).toEqual({ ar: "وش وضع الحلال اليوم؟", en: "How are the camels today?" });
    expect(HERD_COUNT_QUESTION).toEqual({ ar: "كم الحلال عندكم اليوم؟", en: "How many camels are there today?" });
  });

  it("uses Polly's Gulf voice for scripted Arabic and leaves English and Zeina alone", () => {
    expect(sayElement("مرحبا", "ar")).toContain('voice="Polly.Hala-Neural" language="ar-AE"');
    expect(arabicSayLanguage("Polly.Zayd-Neural")).toBe("ar-AE");
    expect(arabicSayLanguage("Polly.Zeina")).toBe("arb");
    vi.stubEnv("NAQAH_VOICE_ARABIC_VOICE", "Polly.Zeina");
    expect(sayElement("مرحبا", "ar")).toContain('voice="Polly.Zeina" language="arb"');
    expect(sayElement("Hello", "en")).toContain('voice="Polly.Joanna" language="en-US"');
    expect(twimlGoodbye("ar")).toContain("يعطيك العافية، مع السلامة.");
    expect(twimlGoodbye("en")).toContain("Thank you. Goodbye.");
  });
});
