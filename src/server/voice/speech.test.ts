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
    scenario: "report_call", step: "test", turns: [], replies: options, inputMode, done: false,
    startedAt: "2026-01-01T00:00:00.000Z",
    draft: { answers: [], camelUpdates: [], resourceUpdates: [], herdAccountedFor: null, taskConfirmations: [] },
    data: {}, notices: [],
  };
}

describe("negated speech never reads as yes", () => {
  const doneReplies: Reply[] = [
    { id: "yes", value: "yes", label: { en: "Yes, it’s done", ar: "إيه، خلصت" } },
    { id: "no", value: "no", label: { en: "Not yet", ar: "باقي" } },
    { id: "unknown", value: "unknown", label: { en: "I don’t know", ar: "ما أدري" } },
  ];
  const task = {
    ...session("choices", doneReplies), step: "report_question",
    data: { reportIndex: 0, queue: [{ kind: "task" as const, id: "task_1", taskId: "1", question: { ar: "", en: "" } }] },
  };
  const summary = {
    ...session("choices", [
      { id: "confirm_save", value: "confirm_save", label: { en: "Confirm and save", ar: "تأكيد وحفظ" } },
      { id: "end_without_save", value: "end_without_save", label: { en: "End without saving", ar: "إنهاء بدون حفظ" } },
    ]),
    step: "report_summary",
  };
  const herd = session("choices", [
    { id: "yes", value: "yes", label: { en: "All are well", ar: "كلها بخير" } },
    { id: "no", value: "no", label: { en: "One needs attention", ar: "فيه وحدة تحتاج متابعة" } },
    { id: "unknown", value: "unknown", label: { en: "I don’t know", ar: "ما أدري" } },
  ]);
  const heat = session("choices", [
    { id: "yes", value: "yes", label: { en: "Yes", ar: "إيه" } },
    { id: "not_enough", value: "not_enough", label: { en: "Not enough", ar: "ما يكفي" } },
  ]);

  it.each(["ما خلصت", "لا ما خلصت", "it's not done", "مو خالص"])("keeps a task open on «%s»", (speech) => {
    expect(mapSpeechToInput(task, speech, null, "ar")).toEqual({ value: "no" });
  });
  it.each(["خلصت", "إيه خلصت", "نعم", "done"])("closes a task only on a clear «%s»", (speech) => {
    expect(mapSpeechToInput(task, speech, null, "ar")).toEqual({ value: "yes" });
  });
  it("doesn't close a task on a near match", () => {
    expect(mapSpeechToInput(task, "خلصت جزء منها وباقي الباقي", null, "ar")).toBeNull();
  });
  it.each(["don't save", "do not save", "save nothing", "لا تأكيد", "بدون تأكيد", "لا تحفظ"])("doesn't save on «%s»", (speech) => {
    expect(mapSpeechToInput(summary, speech, null, "ar")).toEqual({ value: "end_without_save" });
  });
  it.each(["حفظ", "احفظه", "تأكيد وحفظ", "نعم", "confirm", "save"])("saves on a clear «%s»", (speech) => {
    expect(mapSpeechToInput(summary, speech, null, "ar")).toEqual({ value: "confirm_save" });
  });
  it.each(["مو كلها بخير", "مو بخير", "not all are well"])("doesn't mark the herd healthy on «%s»", (speech) => {
    expect(mapSpeechToInput(herd, speech, null, "ar")).toEqual({ value: "no" });
  });
  it("reads a plain «يكفي» as enough, never as not enough", () => {
    expect(mapSpeechToInput(heat, "يكفي", null, "ar")).toEqual({ value: "yes" });
    expect(mapSpeechToInput(heat, "ما يكفي", null, "ar")).toEqual({ value: "not_enough" });
  });
});

describe("what a real caller says or presses", () => {
  it("records I don't know as unknown in free text and quantities, however it is spelled", () => {
    for (const spelling of ["ما ادري", "ما أدري", "مدري", "i don't know"]) {
      expect(mapSpeechToInput(session("text"), spelling)).toEqual({ value: "unknown" });
      expect(mapSpeechToInput(session("number"), spelling)).toEqual({ value: "unknown" });
    }
  });
  it("keeps free text as said when it isn't I don't know", () => {
    expect(mapSpeechToInput(session("text"), "ما ادري وين راحت الناقة")).toEqual({ text: "ما ادري وين راحت الناقة" });
  });
  it("takes a whole quantity from the keypad", () => {
    expect(mapSpeechToInput(session("number"), "", "120")).toEqual({ text: "120" });
  });
});

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

describe("negation reads as what was meant", () => {
  const unknownReply: Reply = { id: "unknown", value: "unknown", label: { en: "I don’t know", ar: "ما أدري" } };
  const herdHealth: CallSession = {
    ...session("choices", [
      { id: "yes", value: "yes", label: { en: "All are well", ar: "كلها بخير" } },
      { id: "no", value: "no", label: { en: "One needs attention", ar: "فيه وحدة تحتاج متابعة" } },
      unknownReply,
    ]),
    step: "report_question",
    data: {
      reportIndex: 0,
      queue: [{ kind: "predefined", id: "herd_health", question: { ar: "", en: "" }, answerKind: "herd-health", resource: null }],
    },
  };
  const level = session("choices", ["good", "medium", "low", "critical", "unknown"].map((value) => ({
    id: value, value, label: { en: value === "good" ? "Enough" : value === "low" ? "Running low" : value, ar: value },
  })));
  const health = session("choices", [
    { id: "healthy", value: "healthy", label: { en: "Healthy", ar: "بصحة جيدة" } },
    { id: "watch", value: "watch", label: { en: "Under watch", ar: "تحت الملاحظة" } },
    { id: "sick", value: "sick", label: { en: "Sick", ar: "مريضة" } },
    unknownReply,
  ]);
  const heat = session("choices", [
    { id: "yes", value: "yes", label: { en: "Yes", ar: "إيه" } },
    { id: "not_enough", value: "not_enough", label: { en: "Not enough", ar: "ما يكفي" } },
    unknownReply,
  ]);

  it.each([
    "لا، ما فيه مريض", "لا ما فيه مريض", "ما في شي", "مو تعبانة", "لا والله ما شفت شي", "لا",
    "no, none are sick", "nothing wrong", "no I don't think so", "كلها بخير", "all fine",
  ])("«%s» on «is any camel sick?» means all are well", (speech) => {
    expect(mapSpeechToInput(herdHealth, speech, null, "ar")).toEqual({ value: "yes" });
  });
  it.each(["فيه وحدة مريضة", "إيه، وحدة تعبانة", "مو كلها بخير", "one is sick", "not all of them are well", "something is wrong"])(
    "«%s» on «is any camel sick?» means one needs attention", (speech) => {
      expect(mapSpeechToInput(herdHealth, speech, null, "ar")).toEqual({ value: "no" });
    },
  );
  it("still takes «ما أدري» as unknown though it holds «ما»", () => {
    expect(mapSpeechToInput(herdHealth, "والله ما أدري", null, "ar")).toEqual({ value: "unknown" });
  });

  it.each([["ما نقص العلف", "good"], ["not low", "good"], ["كافي", "good"], ["مو كافي", "low"], ["ناقص شوي", "low"], ["خلص العلف", "critical"], ["ما باقي شي", "critical"]])(
    "reads «%s» as feed level %s", (speech, value) => {
      expect(mapSpeechToInput(level, speech, null, "ar")).toEqual({ value });
    },
  );
  it.each([["مو تعبانة", "healthy"], ["ما فيها شي", "healthy"], ["not sick", "healthy"], ["مو بخير", "sick"], ["تعبانة", "sick"], ["تحت الملاحظة", "watch"]])(
    "reads «%s» as camel health %s", (speech, value) => {
      expect(mapSpeechToInput(health, speech, null, "ar")).toEqual({ value });
    },
  );
  it.each([["لا ما يكفي", "not_enough"], ["not enough", "not_enough"], ["ما فيه ظل", "not_enough"], ["إيه يكفي", "yes"], ["no problem, they have plenty", "yes"]])(
    "reads «%s» on the heat-day question as %s", (speech, value) => {
      expect(mapSpeechToInput(heat, speech, null, "ar")).toEqual({ value });
    },
  );
  it.each([["no I don't think so", "no"], ["لا والله", "no"], ["ما أظن", "no"], ["إيه أكيد", "yes"], ["yes, correct", "yes"]])(
    "reads «%s» on a yes/no question as %s", (speech, value) => {
      expect(mapSpeechToInput(session(), speech, null, "en")).toEqual({ value });
    },
  );
  it.each([["ما في ولا وحدة", 0], ["none", 0], ["not a single one", 0], ["ما في الا وحدة", 1], ["ولا شي", 0], ["اثنين وأربعين", 42]])(
    "extracts «%s» as %s", (speech, number) => {
      expect(extractNumber(speech)).toBe(number);
    },
  );
});
