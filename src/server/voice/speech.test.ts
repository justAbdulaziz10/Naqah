import { describe, expect, it } from "vitest";
import type { CallSession, Reply } from "@/domain/conversation/engine";
import { extractNumber, extractTime, mapSpeechToInput, normalizeSpeech, unknownReply } from "./speech";

const replies: Reply[] = [
  { id: "yes", value: "yes", label: { en: "Yes", ar: "نعم" } },
  { id: "no", value: "no", label: { en: "No", ar: "لا" } },
  { id: "unknown", value: "unknown", label: { en: "I don't know", ar: "ما أدري" } },
];

function session(inputMode: CallSession["inputMode"] = "choices", options = replies): CallSession {
  return {
    scenario: "worker_report", step: "test", turns: [], replies: options, inputMode, done: false,
    startedAt: "2026-01-01T00:00:00.000Z",
    draft: { answers: [], camelUpdates: [], resourceUpdates: [], herdAccountedFor: null, taskConfirmations: [] },
    data: {}, notices: [],
  };
}

describe("speech normalization", () => {
  it("normalizes Arabic spelling marks, letters, and Arabic-Indic digits", () => {
    expect(normalizeSpeech("إِبْرَاهِيم آية هُدى مُعلّق ١٢٣ ٠۱۲")).toBe("ابراهيم ايه هدي معلق 123 012");
  });
});

describe("yes, no, and unknown choice matching", () => {
  it.each([
    ["إيه", "yes"], ["ايوه", "yes"], ["أيوه", "yes"], ["نعم", "yes"], ["اي", "yes"],
    ["تمام", "yes"], ["yes", "yes"], ["yeah", "yes"], ["yep", "yes"], ["sure", "yes"],
    ["لا", "no"], ["لأ", "no"], ["باقي", "no"], ["مو", "no"], ["no", "no"], ["not yet", "no"],
    ["ما أدري", "unknown"], ["ما ادري", "unknown"], ["ماادري", "unknown"], ["ما اعرف", "unknown"],
    ["لا أعرف", "unknown"], ["مدري", "unknown"], ["I don't know", "unknown"], ["not sure", "unknown"],
  ])("maps %s to %s", (spoken, value) => {
    expect(mapSpeechToInput(session(), spoken, null, "ar")).toEqual({ value });
  });

  it("selects the one-based DTMF choice and matches overlapping bilingual labels", () => {
    expect(mapSpeechToInput(session(), "", "2", "en")).toEqual({ value: "no" });
    const labels: Reply[] = [
      { id: "present", value: "all_present", label: { en: "All camels are present", ar: "الحلال كامل العدد" } },
      { id: "missing", value: "missing", label: { en: "A camel is missing", ar: "فيه ناقة مفقودة" } },
    ];
    expect(mapSpeechToInput(session("choices", labels), "الحلال كامل العدد", null, "ar")).toEqual({ value: "all_present" });
    expect(mapSpeechToInput(session(), "", "8", "ar")).toBeNull();
  });

  it("recognizes the unknown reply by its value or label", () => {
    expect(unknownReply(replies)?.value).toBe("unknown");
    const onlyLabel: Reply[] = [{ id: "dk", value: "unsure", label: { en: "Not sure", ar: "مدري" } }];
    expect(unknownReply(onlyLabel)?.value).toBe("unsure");
  });
});

describe("spoken numbers and times", () => {
  it.each([
    ["٠", 0], ["واحد", 1], ["اثنين", 2], ["ثلاث", 3], ["أربعة", 4], ["خمسة", 5],
    ["ستة", 6], ["سبعة", 7], ["ثمانية", 8], ["تسعة", 9], ["عشرة", 10], ["أحد عشر", 11],
    ["اثنا عشر", 12], ["ثلاثة عشر", 13], ["أربعة عشر", 14], ["خمسة عشر", 15], ["ستة عشر", 16],
    ["سبعة عشر", 17], ["ثمانية عشر", 18], ["تسعة عشر", 19], ["عشرين", 20], ["ثلاثين", 30],
    ["خمسة وعشرين", 25], ["twenty", 20], ["thirty", 30], ["٠٢", 2],
  ])("extracts %s as %s", (spoken, number) => {
    expect(extractNumber(spoken)).toBe(number);
  });

  it.each([
    ["الساعة ٥:٠٥", "05:05"], ["17:30", "17:30"], ["5 pm", "17:00"], ["12 am", "00:00"],
    ["at five pm", "17:00"], ["الساعة خمسة مساء", "17:00"], ["عند ٧ صباحا", "07:00"],
  ])("extracts %s as %s", (spoken, time) => {
    expect(extractTime(spoken)).toBe(time);
  });

  it("formats number and time inputs and passes text unchanged", () => {
    expect(mapSpeechToInput(session("number"), "قرابة عشرين", null, "ar")).toEqual({ text: "20" });
    expect(mapSpeechToInput(session("time"), "5:30 pm", null, "en")).toEqual({ text: "17:30" });
    expect(mapSpeechToInput(session("text"), "  ما فيه زوار  ", null, "ar")).toEqual({ text: "ما فيه زوار" });
    expect(mapSpeechToInput(session("number"), "كثير", null, "ar")).toBeNull();
    expect(mapSpeechToInput(session("none"), "yes", null, "en")).toBeNull();
  });
});
