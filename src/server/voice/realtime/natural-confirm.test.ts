import { describe, expect, it } from "vitest";
import { reportSummaryId } from "@/domain/conversation/engine";
import type { VoiceCallSession } from "../farm-call";
import { isNaturalConfirmation } from "./confirmation";
import { decideTool } from "./decide";
import { at, NOW } from "./saudi-cases";

const summary = () => at("summary");

describe("a spoken yes on a natural call, through phone transcription", () => {
  // The three replies the transcriber returned on the 11 Nov call, after the whole summary was read.
  it.each(["كل كلام لا تعدل.", "كل شيء تمام. لا تتعدى لأحفظك.", "إيه احفظه", "تمام احفظ", "صح كله مضبوط", "ما فيه تعديل", "زين، ماشي"])("saves on «%s»", (heard) => {
    expect(isNaturalConfirmation(heard, summary().session, "ar")).toBe(true);
  });

  it.each(["كل شيء نام.", "لا", "لا تحفظ", "ما ابي احفظ", "إيه بس العلف غلط", "تمام لكن الماء ناقص", "عدل الشبك", "تمام؟", "مدري", "يمكن", "إيه احفظه بس عدل الحليب"])("does not save on «%s»", (heard) => {
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
