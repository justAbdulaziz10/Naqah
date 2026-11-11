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
