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
  it.each(["ما فيه مريض", "لا، ما فيه مشاكل", "no camels are sick", "all are well", "كلها بخير", "nothing is wrong"])("does not end or save the call on an unrelated farm answer «%s»", (speech) => {
    expect(mapSpeechToInput(summary, speech, null, "ar", "0.8972015")).toBeNull();
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
  it("never saves keypad digits as an owner-written text answer", () => {
    const custom = { ...session("text"), step: "report_question", data: { reportIndex: 0, queue: [{ kind: "custom" as const, id: "custom-1", question: { ar: "وش الجديد؟", en: "What is new?" } }] } };
    expect(mapSpeechToInput(custom, "", "1")).toBeNull();
    expect(mapSpeechToInput(custom, "", "12")).toBeNull();
  });
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

describe("report mode and correction speech", () => {
  const options = (values: string[]) => values.map((value) => ({ id: value, value, label: { ar: value, en: value } }));
  const summary = { ...session("choices", options(["confirm_save", "correct", "end_without_save"])), step: "report_summary" };
  it.each(["لا", "لا والله", "no", "مو صحيح"])("offers correction for a summary denial: %s", (speech) => {
    expect(mapSpeechToInput(summary, speech)).toEqual({ value: "correct" });
  });
  it.each(["لا تحفظ", "لا تحفظه", "don't save", "do not save"])("ends without saving only on an explicit request: %s", (speech) => {
    expect(mapSpeechToInput(summary, speech)).toEqual({ value: "end_without_save" });
  });
  it.each(["لا", "بس", "ما عندي شي"])("finishes the open update on %s", (speech) => {
    expect(mapSpeechToInput({ ...session("text"), step: "open_more" }, speech)).toEqual({ value: "open_done" });
  });
  it.each([["أسئلة", "mode_guided"], ["guided", "mode_guided"], ["مفتوح", "mode_open"], ["open", "mode_open"]])("chooses the report mode from %s", (speech, value) => {
    expect(mapSpeechToInput({ ...session("choices", options(["mode_guided", "mode_open"])), step: "report_mode_choice" }, speech)).toEqual({ value });
  });
  it("picks an offered correction or returns to the full summary", () => {
    const pick = { ...session("choices", [{ id: "feed", value: "correct:feed_level", label: { ar: "العلف", en: "Feed" } }, ...options(["back_to_summary", "end_without_save"])]), step: "report_correct_pick" };
    expect(mapSpeechToInput(pick, "العلف")).toEqual({ value: "correct:feed_level" });
    expect(mapSpeechToInput(pick, "ارجع")).toEqual({ value: "back_to_summary" });
    expect(mapSpeechToInput(pick, "", "1")).toEqual({ value: "correct:feed_level" });
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
    ["ثلاثين كيس", 30], ["مية وخمسين لتر", 150], ["مائة وخمسة وعشرين لتر", 125],
    ["تقريبا عشرة", 10], ["٤٠", 40], ["٤٠،", 40], ["حوالي ١٠٠ وخمسين", 150],
    ["عشرين وخمسة", 25], ["ميتين وثلاثين", 230], ["ألف ومية وخمسين", 1150],
    ["thirty bags", 30], ["one hundred and fifty litres", 150], ["a hundred and fifty litres", 150], ["about ten", 10],
    ["twenty-five", 25], ["about 40 litres", 40], ["12.5 litres", 12.5], ["١٢٫٥ لتر", 12.5],
  ])("understands worker quantity «%s» as %s", (speech, quantity) => {
    expect(mapSpeechToInput(session("number"), speech)).toEqual({ text: String(quantity) });
  });
  it.each(["عشرين أو ثلاثين", "20 bags and 30 litres", "twenty thirty", "zero twenty", "صفر عشرين", "minus twenty", "-20", "سالب عشرة", "constructor", "ما", "one hundred and"]) (
    "does not guess an ambiguous or partial quantity «%s»", (speech) => {
      expect(mapSpeechToInput(session("number"), speech)).toBeNull();
    },
  );
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

describe("recognition quality and explicit confirmations", () => {
  it.each(["0", "0.2", "0.45", "0.49", "NaN", "", "-1", "1.1"])("does not discard recognized words on confidence %s alone", (confidence) => {
    expect(mapSpeechToInput(session("number"), "مية وخمسين", null, "ar", confidence)).toEqual({ text: "150" });
    expect(mapSpeechToInput(session(), "yes", null, "en", confidence)).toEqual({ value: "yes" });
  });
  it("accepts a missing confidence field and gives keypad input precedence", () => {
    expect(mapSpeechToInput(session("number"), "عشرين", null, "ar", null)).toEqual({ text: "20" });
    expect(mapSpeechToInput(session("number"), "", "150", "ar", "0.1")).toEqual({ text: "150" });
    expect(mapSpeechToInput(session(), "no", "1", "en", "0.1")).toEqual({ value: "yes" });
    expect(mapSpeechToInput(session("number"), "20", "1234567")).toBeNull();
  });
  it.each(["callback_task_confirmation", "outbound_task_confirmation", "outbound_receipt"])("requires clear speech at %s", (step) => {
    const confirmation = { ...session(), step };
    expect(mapSpeechToInput(confirmation, "نعم لا")).toBeNull();
    expect(mapSpeechToInput(confirmation, "yes no")).toBeNull();
    expect(mapSpeechToInput(confirmation, "ايوه يمكن")).toBeNull();
    expect(mapSpeechToInput(confirmation, "yes maybe")).toBeNull();
    expect(mapSpeechToInput(confirmation, "ما أدري")).toEqual({ value: "unknown" });
    expect(mapSpeechToInput(confirmation, "ايوه")).toEqual({ value: "yes" });
    expect(mapSpeechToInput(confirmation, "لا والله")).toEqual({ value: "no" });
  });
  it.each(["والله ما أدري", "ما أعرف والله", "I don't know honestly"])("keeps «%s» unknown", (speech) => {
    expect(mapSpeechToInput(session("number"), speech)).toEqual({ value: "unknown" });
    expect(mapSpeechToInput(session("text"), speech)).toEqual({ value: "unknown" });
  });
});

describe("Saudi Arabic capture regressions", () => {
  const options = (values: string[]): Reply[] => values.map((value) => ({ id: value, value, label: { ar: value, en: value } }));
  const question = (id: string, answerKind: "level" | "herd-health" | "yesno", resource: "feed" | "water" | null, values: string[]): CallSession => ({
    ...session("choices", options(values)), step: "report_question",
    data: { reportIndex: 0, queue: [{ kind: "predefined", id, answerKind, resource, question: { ar: "", en: "" } }] },
  });
  const herd = question("herd_health", "herd-health", null, ["yes", "no", "unknown"]);
  const feed = question("feed_level", "level", "feed", ["good", "medium", "low", "critical", "unknown"]);
  const water = question("water_level", "level", "water", ["good", "medium", "low", "critical", "unknown"]);
  const summary = { ...session("choices", options(["confirm_save", "end_without_save"])), step: "report_summary" };

  it.each(["اوكي", "طيب", "ok", "okay"])("accepts summary confirmation %s even at zero confidence", (speech) => {
    expect(mapSpeechToInput(summary, speech, null, "ar", "0.0")).toEqual({ value: "confirm_save" });
  });
  it.each(["تمام", "كل شي تمام", "تمام الحمد لله", "ما عليهم خلاف", "الحمد لله"])("does not turn reassurance %s into a sick-camel finding", (speech) => {
    expect(mapSpeechToInput(herd, speech, null, "ar", "0.45")).toEqual({ value: "yes" });
  });
  it.each([["باقي شوي", "low"], ["شوي", "low"], ["النص", "medium"], ["باقي النص", "medium"], ["موجود", "good"]])("understands feed level %s", (speech, value) => {
    expect(mapSpeechToInput(feed, speech, null, "ar", "0")).toEqual({ value });
  });
  it.each(["إيه", "نعم", "ايوه", "yes"])("does not invent a level from a bare affirmation %s", (speech) => {
    expect(mapSpeechToInput(feed, speech, null, "ar")).toBeNull();
  });
  it.each([["عشرين كيس", "20"], ["باقي كيسين", "2"]])("passes the quantity %s to the feed or water engine", (speech, quantity) => {
    expect(mapSpeechToInput(feed, speech, null, "ar")).toEqual({ text: quantity });
    expect(mapSpeechToInput(water, speech, null, "ar")).toEqual({ text: quantity });
  });
  it.each([["ثلاث مية", 300], ["ألفين", 2000], ["اثنعش", 12], ["خمسطعش", 15], ["ثلاث مية وخمسين", 350], ["ألفين وخمسين", 2050]])("extracts colloquial quantity %s", (speech, quantity) => {
    expect(extractNumber(speech)).toBe(quantity);
  });
  it.each(["خربان", "مكسور"])("reads fence damage %s as a problem", (speech) => {
    expect(mapSpeechToInput(question("fences_condition", "level", null, ["good", "medium", "low", "critical", "unknown"]), speech)).toEqual({ value: "low" });
  });
  it("matches camel names with or without the definite article", () => {
    const camel = { ...session("choices", [{ id: "camel:test", value: "camel:test", label: { ar: "الحمرا", en: "Al Hamra" } }]), step: "health_pick" };
    expect(mapSpeechToInput(camel, "حمرا")).toEqual({ value: "camel:test" });
  });
  it.each([["ما تاكل", "sick"], ["تعرج", "sick"], ["نراقبها", "watch"]])("captures the reported camel condition %s", (speech, value) => {
    expect(mapSpeechToInput({ ...session("choices", options(["healthy", "sick", "watch", "unknown"])), step: "health_status" }, speech)).toEqual({ value });
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
    "لا، ما فيه مريض", "لا ما فيه مريض", "ما في شي", "مو تعبانة", "لا والله ما شفت شي",
    "no, none are sick", "nothing wrong", "كلها بخير", "all fine",
  ])("«%s» on «is any camel sick?» means all are well", (speech) => {
    expect(mapSpeechToInput(herdHealth, speech, null, "ar")).toEqual({ value: "yes" });
  });
  // Known product gap: the question is now «كيف الحلال اليوم؟», so a bare yes or no should be asked again,
  // but choiceInput's YES_WORDS/NO_WORDS fallthrough still maps it. Remove `.fails` when that is fixed.
  it.each(["لا", "إيه", "no", "yes"])("asks again on a bare «%s» to «how are the camels?»", (speech) => {
    expect(mapSpeechToInput(herdHealth, speech, null, "ar")).toBeNull();
  });
  it.each(["فيه وحدة مريضة", "إيه، وحدة تعبانة", "مو كلها بخير", "one is sick", "not all of them are well", "something is wrong"])(
    "«%s» on «is any camel sick?» means one needs attention", (speech) => {
      expect(mapSpeechToInput(herdHealth, speech, null, "ar")).toEqual({ value: "no" });
    },
  );
  it("still takes «ما أدري» as unknown though it holds «ما»", () => {
    expect(mapSpeechToInput(herdHealth, "والله ما أدري", null, "ar")).toEqual({ value: "unknown" });
  });

  it.each([["ما نقص العلف", "good"], ["not low", "good"], ["كافي", "good"], ["مو كافي", "low"], ["ناقص شوي", "low"], ["قارب يخلص", "low"], ["running low", "low"], ["nearly empty", "low"], ["not nearly empty", "good"], ["ما قارب يخلص", "good"], ["خلص العلف", "critical"], ["ما باقي شي", "critical"]])(
    "reads «%s» as feed level %s", (speech, value) => {
      expect(mapSpeechToInput(level, speech, null, "ar")).toEqual({ value });
    },
  );
  it.each([["مو تعبانة", "healthy"], ["ما فيها شي", "healthy"], ["not sick", "healthy"], ["سليم", "healthy"], ["مو بخير", "sick"], ["تعبانة", "sick"], ["تحت الملاحظة", "watch"]])(
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

describe("review regressions", () => {
  it("reads Arabic afternoon and evening words as PM, and morning words as AM", () => {
    expect(extractTime("الساعة خمسة العصر")).toBe("17:00");
    expect(extractTime("6 المغرب")).toBe("18:00");
    expect(extractTime("8 العشاء")).toBe("20:00");
    expect(extractTime("واحدة الظهر")).toBe("13:00");
    expect(extractTime("7 الصبح")).toBe("07:00");
  });

  it("does not take a near match as proof the worker heard the instructions", () => {
    const session = { step: "outbound_receipt", inputMode: "choices", replies: [{ id: "received", value: "received", label: { ar: "إيه، سمعتها", en: "Yes, I heard them" } }], data: {}, draft: {}, turns: [] } as never;
    expect(mapSpeechToInput(session, "وش سمعتها", null, "ar")).toBeNull();
    expect(mapSpeechToInput(session, "I heard them barely", null, "en")).toBeNull();
  });
});
