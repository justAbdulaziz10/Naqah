import { describe, expect, it } from "vitest";
import { reportSummaryId } from "@/domain/conversation/engine";
import type { VoiceCallSession } from "../farm-call";
import { isNaturalConfirmation } from "./confirmation";
import { decideTool } from "./decide";
import { at, NOW } from "./saudi-cases";

const summary = () => at("summary");

describe("natural confirmation intent takes precedence over a leading yes", () => {
  const phrases: [string, boolean][] = [
    ["إيه أبي أعدل", false], ["إيه عدلي", false], ["ايه ابغى اغير", false],
    ["أعدل", false], ["عدل", false], ["عدلي", false], ["غير", false], ["أغير", false],
    ["ابغى اغير", false], ["إيه أعدل", false], ["تمام عدليه", false], ["احفظي وغيري", false],
    ["احفظ واصحح", false], ["إيه ودي أصحح", false], ["ايوا فيه تعديل", false],
    ["لحظة", false], ["إيه لحظة", false], ["استنى", false], ["احفظي استني", false],
    ["مو صح", false], ["إيه مو صح", false], ["غلط", false], ["تمام غلط", false],
    ["ايوا مو صحيح", false], ["إيه مو مضبوطة", false], ["نعم غير صحيح", false],
    ["إِيـه أَبِي أُعَدِّل", false], ["آيه ٱبغى ٱغير", false], ["إيه    أبي    أعدل", false],
    ["لا تعدل بس أغير", false], ["لا تعدل بس الماء ناقص", false], ["ما يحتاج تعدل غلط", false],
    ["لا، تمام احفظ بس عدلي", false], ["لا تعدل، لحظة", false], ["لا تعدل لا تحفظي", false],
    ["ايوا لا تسجلي", false], ["احفظي لا", false], ["ما أبي أحفظي", false],
    ["ايوا لا تحفظين", false], ["إيه لا تسجلينه", false],
    ["لا أبي أعدل", false], ["لا، أبي أعدل", false], ["لا ابغى اغير", false], ["لا ودي اصحح", false],
    ["مو أبي أعدل", false], ["لا ابي اغير شي", false], ["ايه بس ابي اعدل", false],
    // Adversarial review, 13 Nov: hedges, Gulf negations, correction words, unmarked questions, conditions.
    ["ايه شكله صح", false], ["شكله صح", false], ["صح تقريبا", false], ["تمام تقريبا", false], ["ايه احسب", false],
    ["ايه احتمال", false], ["يبدو صح", false], ["ايه ناقص", false], ["ايه زيادة", false], ["ايه اقل", false],
    ["ايه اكثر", false], ["ايه مو كذا", false], ["ايه مب صح", false], ["مب صح", false], ["ماهو صح", false],
    ["ما صح", false], ["موب صح", false], ["ايه غلطتي", false], ["ايه اخطأت", false], ["ايه انتي غلطانة", false],
    ["ايه ممم", false], ["ايه يعني", false], ["ايه كم قلتي", false], ["ايه ليش", false], ["ايه ولا", false],
    ["تمام ولا", false], ["احفظه ولا", false], ["اقول تمام", false], ["هل احفظه", false],
    ["احفظ اذا كان صح", false], ["ايه ان شاء الله", false], ["احفظ بكرا", false], ["ايه وبعدين", false],
    ["ايه ما", false], ["ايه عشان", false], ["الو تمام", false],
    // PR #22 review: a "nothing to change" start must not hide a refusal to save.
    ["لا تعدلي ولا تحفظي", false], ["لا تعدلي ولا تسجلي", false], ["لا تعدل وما تحفظه", false],
    ["do not change it or save it", false], ["don't change it and don't save", false], ["no changes but do not save", false],
    ["لا شكرا", false], ["لا شكرا احفظ", false], ["لا", false], ["احفظي؟", false],
    ["لا تعدل", true], ["ما يحتاج تعدل", true], ["لا، تمام احفظ", true],
    ["لا ما أبي أعدل شي", true], ["ما ابغى اغير", true], ["ما فيه تعديل", true],
    ["ما في تعديل", true], ["مافيه تعديل", true], ["لا تغير", true], ["لا تعدلي", true],
    ["ما يحتاج أعدل", true], ["ما ابي اعدل", true], ["لا يحتاج تعدل", true], ["إيه لا تعدل شي", true], ["لا تعدل ولا تغير", true],
    ["ما فيه تعديل، احفظي", true], ["ما يحتاج تعدل، لا تغير", true],
    ["لَا تـعَدِّل", true], ["ما    يحتاج    تعدل", true],
    ["احفظ", true], ["احفظي", true], ["احفظه", true], ["احفظيه", true], ["احفظيها", true],
    ["حفظ", true], ["سجل", true], ["سجلي", true], ["سجليه", true], ["سجليها", true],
    ["ايوا", true], ["إيه", true], ["اي", true], ["نعم", true], ["تمام", true],
    ["صح", true], ["أكيد", true], ["زين", true], ["إِيـوَا", true], ["ٱحْفَظِي", true],
    ["آكيد", true], ["إيه تمام يعطيك العافية", true],
    ["no wait", false], ["yes edit it", false], ["yes I want to change it", false],
    ["yes correction", false], ["okay wrong", false], ["yes not right", false],
    ["yes correct it", false], ["please correct the report", false],
    ["save it but wait", false], ["yes don't save", false], ["no thanks", false],
    ["no changes but edit it", false], ["nothing to change wait", false],
    ["yes", true], ["save it", true], ["yes that's correct", true], ["no changes", true],
    ["nothing to change", true], ["no need to edit", true], ["don't change it", true],
    ["yes correct and save", true],
  ];

  it.each(phrases)("classifies «%s» as confirmation=%s", (heard, confirmed) => {
    expect(isNaturalConfirmation(heard, summary().session, "ar")).toBe(confirmed);
  });

  it.each(phrases)("gates confirm_report on «%s» (confirmation=%s)", (heard, confirmed) => {
    const { ws, session } = summary();
    const original = structuredClone(session);
    const decision = decideTool({ session: session as VoiceCallSession, counters: {}, workspace: ws, locale: "ar", name: "confirm_report", args: { confirmed: true }, spoke: true, heard, heardSummaryId: reportSummaryId(session, "ar"), now: NOW, natural: true });
    expect(decision.kind === "apply").toBe(confirmed);
    expect(session).toEqual(original);
  });

  it.each(["en", "ar"] as const)("keeps English consent working in %s calls", (locale) => {
    for (const [heard, confirmed] of phrases.filter(([heard]) => /^[a-z]/i.test(heard))) {
      expect(isNaturalConfirmation(heard, summary().session, locale), heard).toBe(confirmed);
    }
  });
});

describe("a spoken yes on a natural call, through phone transcription", () => {
  // The three replies the transcriber returned on the 11 Nov call, after the whole summary was read.
  it.each(["كل كلام لا تعدل.", "كل شيء تمام. لا تتعدى لأحفظك.", "احفظ لاشعريلي.", "إيه احفظه", "تمام احفظ", "صح كله مضبوط", "ما فيه تعديل", "زين، ماشي"])("saves on «%s»", (heard) => {
    expect(isNaturalConfirmation(heard, summary().session, "ar")).toBe(true);
  });

  it.each(["كل شيء نام.", "أهلا بكم.", "عفوا.", "لا", "لا تحفظ", "ما ابي احفظ", "إيه بس العلف غلط", "تمام لكن الماء ناقص", "عدل الشبك", "تمام؟", "مدري", "يمكن", "إيه احفظه بس عدل الحليب"])("does not save on «%s»", (heard) => {
    expect(isNaturalConfirmation(heard, summary().session, "ar")).toBe(false);
  });

  it("saves through the model's confirm_report when the summary was heard", () => {
    const { ws, session } = summary();
    const decision = decideTool({ session: session as VoiceCallSession, counters: {}, workspace: ws, locale: "ar", name: "confirm_report", args: { confirmed: true }, spoke: true, heard: "كل شيء تمام. لا تتعدى لأحفظك.", heardSummaryId: reportSummaryId(session, "ar"), now: NOW, natural: true });
    expect(decision.kind).toBe("apply");
  });

  it("still needs the whole summary heard", () => {
    const { ws, session } = summary();
    const decision = decideTool({ session: session as VoiceCallSession, counters: {}, workspace: ws, locale: "ar", name: "confirm_report", args: { confirmed: true }, spoke: true, heard: "إيه احفظه", heardSummaryId: "other", now: NOW, natural: true });
    expect(decision.kind).toBe("reply");
  });

  it("the guided call keeps its stricter rule", () => {
    const { ws, session } = summary();
    const decision = decideTool({ session: session as VoiceCallSession, counters: {}, workspace: ws, locale: "ar", name: "confirm_report", args: { confirmed: true }, spoke: true, heard: "كل كلام لا تعدل.", heardSummaryId: reportSummaryId(session, "ar"), now: NOW });
    expect(decision.kind).toBe("reply");
  });

  it("after three unclear replies it ends honestly, saving nothing, with no connection-problem message", () => {
    const { ws, session } = summary();
    const decision = decideTool({ session: session as VoiceCallSession, counters: { confirmationFailures: 2 }, workspace: ws, locale: "ar", name: "confirm_report", args: { confirmed: true }, spoke: true, heard: "كل شيء نام.", heardSummaryId: reportSummaryId(session, "ar"), now: NOW, natural: true });
    expect(decision.kind).toBe("end");
  });
});

/** The review's RT-1 table (11 Nov): at the summary, with the model already asking to save. */
describe("the natural yes filter: waiting, asking and doubting are not a yes", () => {
  it.each([
    "طيب انتظر", "تمام بعدين", "ايه وش قلت", "ايوه مين معي", "زين خلني اتاكد", "اوكي ثواني", "تمام قل للمعزب يتصل علي",
    "طيب اسمع", "ايه ابي اكلم المعزب", "احفظ وقل للمعزب ان كل شي تمام", "ok wait", "yes hold on", "الله يسلمك",
    "تمام ما ادري", "ايه بس وحده ضايعه", "ايه اظن", "ايه لحظة", "اصبر شوي", "ايش", "okay what",
    "yes maybe later", "احفظ لا لحظة", "أحفظ لا", "ايه ايه لا",
  ])("does not save on «%s»", (heard) => {
    expect(isNaturalConfirmation(heard, summary().session, "ar")).toBe(false);
  });

  it.each([
    "ايه احفظ", "احفظه الله يعافيك", "اي نعم صحيح", "تمام كذا", "yes please save", "yes that's all correct", "ايوه يا شيخ احفظه",
    "تمام يعطيك العافية", "احفظ احفظ", "توكل على الله", "يلا احفظ", "ايه ايه", "أحفظ احفظ", "طيب", "زين", "اوكي تمام",
    // Changed 12 Nov: the summary now ends on a plain «أحفظه؟», so «طيب» with only filler around it answers that
    // yes/no question. It was a refusal while the question was «أحفظه، ولا تبي تعدل شي؟».
    "طيب طيب يا جماعة الخير",
  ])("saves on «%s»", (heard) => {
    expect(isNaturalConfirmation(heard, summary().session, "ar")).toBe(true);
  });
});

/** The owner's list (12 Nov): after «أحفظه؟», the ordinary ways a Saudi worker says yes. */
describe("a plain yes to «أحفظه؟», said many ways", () => {
  const camels = () => summary().ws.camels;
  it.each([
    "إيه", "ايوه", "أيوه", "اي", "صح", "تمام", "تمام احفظ", "خلاص", "خلاص احفظ", "ماشي", "اوكي", "زين", "طيب احفظ", "كذا تمام", "كله صح",
    "كل شي تمام", "احفظه", "احفظ", "سجله", "يلا", "توكل على الله", "ايه يعطيك العافية", "احفظ الله يعطيك العافية", "yes", "ok", "okay", "sure",
    "done", "save it", "correct", "yes please", "that's right",
  ])("saves on «%s»", (heard) => {
    expect(isNaturalConfirmation(heard, summary().session, "ar", camels())).toBe(true);
  });

  it.each([
    // Doubt, waiting or a question.
    "لحظة", "تمام لحظة", "انتظر", "وش", "مين", "بعدين", "اظن", "يمكن", "ايه يمكن", "wait", "what", "maybe", "okay wait",
    // Thanks or a goodbye alone is not an explicit yes.
    "الله يعطيك العافية", "يعطيك العافية", "يعطيك العافية يا شيخ",
    // A no, alone or last.
    "لا", "لا شكرا", "احفظ لا", "تمام لا", "no", "yes no",
    // A correction: a number, a camel's name, a topic.
    "تمام عشرين كيس", "ايه 30", "ايه مزون بخير", "تمام وضحة", "صح بس الماي ناقص", "تمام العلف", "ok the water",
    // A soft word beside something else.
    "خلاص اقفل", "طيب الحين", "يلا مع السلامة",
  ])("does not save on «%s»", (heard) => {
    expect(isNaturalConfirmation(heard, summary().session, "ar", camels())).toBe(false);
  });
});

describe("an urgent concern at a natural call's summary", () => {
  it("is read back in the short summary, ending on «أحفظه؟», and only the new summary can be confirmed", () => {
    const { ws, session } = summary();
    const decision = decideTool({ session: session as VoiceCallSession, counters: {}, workspace: ws, locale: "ar", name: "flag_urgent", args: { note: "مزون طايحة" }, spoke: true, heard: "مزون طايحة ما تقوم", now: NOW, natural: true });
    expect(decision.kind).toBe("stay");
    if (decision.kind !== "stay") return;
    expect(decision.result.summaryText).toMatch(/^.*هذا اللي فهمته: .*الأمر العاجل اللي ذكرته: مزون طايحة ما تقوم\. أحفظه؟$/u);
    expect(decision.result.summaryId).toBe(reportSummaryId(decision.session, "ar"));
    expect(decision.result.summaryId).not.toBe(reportSummaryId(session, "ar"));
  });
});

describe("a natural call's three strikes are the worker's own unclear replies", () => {
  const confirm = (heard: string, heardSummaryId: string | undefined, counters = {}, spoke = true) => {
    const { ws, session } = summary();
    return decideTool({ session: session as VoiceCallSession, counters, workspace: ws, locale: "ar", name: "confirm_report", args: { confirmed: true }, spoke, heard, heardSummaryId, now: NOW, natural: true });
  };
  const id = () => reportSummaryId(summary().session, "ar");
  const said = (decision: ReturnType<typeof decideTool>) => (decision.kind === "reply" ? decision.result : null);

  it("the model asking before the summary was heard is no strike, and the summary is read again in full", () => {
    const decision = confirm("موقعية", undefined);
    expect(decision.kind).toBe("reply");
    expect(decision.counters).toMatchObject({ confirmationFailures: 0, confirmationMisses: 1 });
    expect(said(decision)?.summaryText).toBeTruthy();
  });

  it("once the summary was heard in full, a miss asks only «أحفظه؟»", () => {
    const decision = confirm("", undefined, { summaryHeardId: id() });
    expect(decision.counters.confirmationFailures).toBe(0);
    expect(said(decision)?.summaryText).toBeUndefined();
    expect(said(decision)?.sayText).toBe("أحفظه؟");
  });

  it("an older summary heard in full doesn't spare a new one its reading", () => {
    expect(said(confirm("", undefined, { summaryHeardId: "0:older" }))?.summaryText).toBeTruthy();
  });

  it("a request carrying the heard summary remembers it for later re-asks", () => {
    expect(confirm("موقعية", id()).counters.summaryHeardId).toBe(id());
  });

  it("the worker's own unclear reply to the heard summary is a strike, asked again briefly", () => {
    const decision = confirm("بالعراق", id());
    expect(decision.counters.confirmationFailures).toBe(1);
    expect(said(decision)?.summaryText).toBeUndefined();
  });

  it("a plain «لا» to the heard summary asks what to change: no save, no strike, no ending", () => {
    for (const heard of ["لا", "لا شكرا", "no"]) {
      const decision = confirm(heard, id());
      expect(decision.kind).toBe("reply");
      expect(decision.counters.confirmationFailures).toBe(0);
      expect(said(decision)?.sayText).toBe("وش تبي نعدل؟");
      expect(said(decision)?.summaryText).toBeUndefined();
    }
    // Three of them in a row still never end the call by strikes.
    expect(confirm("لا", id(), { confirmationFailures: 2 }).kind).toBe("reply");
  });

  it("a summary read again after a reply over it ends on the plain question", () => {
    expect(said(confirm("لا شكرا احفظ", undefined))?.repromptText).toBe("أحفظه؟");
  });

  it("the model confirming with no worker words is no strike", () => {
    expect(confirm("", id(), {}, false).counters).toMatchObject({ confirmationFailures: 0, confirmationMisses: 1 });
  });

  it("a long run of timing misses still ends the call, unsaved", () => {
    expect(confirm("", undefined, { confirmationMisses: 5 }).kind).toBe("end");
    expect(confirm("", undefined, { confirmationMisses: 4 }).kind).toBe("reply");
  });

  it("the guided call still counts every miss", () => {
    const { ws, session } = summary();
    const decision = decideTool({ session: session as VoiceCallSession, counters: {}, workspace: ws, locale: "ar", name: "confirm_report", args: { confirmed: true }, spoke: true, heard: "إيه احفظه", heardSummaryId: undefined, now: NOW });
    expect(decision.counters.confirmationFailures).toBe(1);
  });

  /** Each step: what the worker was transcribed saying, and whether the bridge says the summary was heard first. */
  const replay = (steps: [string, boolean][]) => {
    let counters = {};
    return steps.map(([heard, heardFirst]) => {
      const decision = confirm(heard, heardFirst ? id() : undefined, counters);
      counters = { ...counters, ...decision.counters };
      return decision.kind;
    });
  };

  it("call 050ac3 now saves: a stray word before the summary, then «أحفظ… احفظ» sent together", () => {
    expect(replay([["موقعية", false], ["أحفظ احفظ", true]])).toEqual(["reply", "apply"]);
  });

  it("call 050ac3 as the old bridge sent it no longer ends the call: its yes still saves", () => {
    expect(replay([["موقعية", false], ["", false], ["بالعراق", true], ["احفظ", true]])).toEqual(["reply", "reply", "reply", "apply"]);
  });

  it("call 4f6a40 now saves: two early confirms, then «احفظ» over the closing question", () => {
    expect(replay([["أهلا بكم", false], ["عفوا", false], ["احفظ", true]])).toEqual(["reply", "reply", "apply"]);
    // Even if those two words came after the summary was heard, they are two strikes, not three.
    expect(replay([["أهلا بكم", true], ["عفوا", true], ["احفظ", true]])).toEqual(["reply", "reply", "apply"]);
  });
});
