import { describe, expect, it } from "vitest";
import { reportSummaryId } from "@/domain/conversation/engine";
import type { VoiceCallSession } from "../farm-call";
import { isNaturalConfirmation } from "./confirmation";
import { decideTool } from "./decide";
import { at, NOW } from "./saudi-cases";

const summary = () => at("summary");

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
    "طيب طيب يا جماعة الخير", "تمام ما ادري", "ايه بس وحده ضايعه", "ايه اظن", "ايه لحظة", "اصبر شوي", "ايش", "okay what",
    "yes maybe later", "احفظ لا لحظة", "أحفظ لا", "ايه ايه لا",
  ])("does not save on «%s»", (heard) => {
    expect(isNaturalConfirmation(heard, summary().session, "ar")).toBe(false);
  });

  it.each([
    "ايه احفظ", "احفظه الله يعافيك", "اي نعم صحيح", "تمام كذا", "yes please save", "yes that's all correct", "ايوه يا شيخ احفظه",
    "تمام يعطيك العافية", "احفظ احفظ", "توكل على الله", "يلا احفظ", "ايه ايه", "أحفظ احفظ", "طيب", "زين", "اوكي تمام",
  ])("saves on «%s»", (heard) => {
    expect(isNaturalConfirmation(heard, summary().session, "ar")).toBe(true);
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
