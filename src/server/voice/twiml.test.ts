import { describe, expect, it } from "vitest";
import type { CallSession } from "@/domain/conversation/engine";
import { agentText, escapeXml, sayElement, twimlGather, twimlGoodbye, twimlSayThenRedirect } from "./twiml";

const session: CallSession = {
  scenario: "report_call", step: "confirm",
  turns: [{ speaker: "agent", text: { en: "Say & confirm", ar: "قل نعم" }, at: "2026-01-01T00:00:00.000Z" }],
  replies: [{ id: "yes", value: "yes", label: { en: "Yes", ar: "نعم" } }],
  inputMode: "choices", done: false, startedAt: "2026-01-01T00:00:00.000Z",
  draft: { answers: [], camelUpdates: [], resourceUpdates: [], herdAccountedFor: null, taskConfirmations: [] }, data: {}, notices: [],
};

describe("TwiML output", () => {
  it("asks for a spoken answer on text steps", () => {
    expect(agentText({ ...session, inputMode: "text" }, "ar")).toContain("قل إجابتك بصوتك");
    expect(agentText({ ...session, inputMode: "text" }, "en")).toContain("say your answer aloud");
  });

  it("reads only the question when options are hidden, and the options otherwise", () => {
    expect(agentText(session, "en", false)).toBe("Say & confirm");
    expect(agentText(session, "en")).toContain("Press 1 for Yes");
    expect(agentText({ ...session, inputMode: "number" }, "ar", false)).not.toContain("اضغط");
    expect(agentText({ ...session, inputMode: "text" }, "en", false)).toBe("Say & confirm");
    expect(twimlGather(session, "en", "/t", "", false)).not.toContain("Press 1");
    expect(twimlGather(session, "en", "/t")).toContain("Press 1");
    expect(twimlGather(session, "en", "/t", "", false)).toContain("<Gather");
  });

  it("never swaps words inside literal owner-written text", () => {
    const literal = { ...session, turns: [{ ...session.turns[0], literal: true, text: { ar: "أحمد، وش وضع المزرعة؟", en: "Ahmed, how is the farm?" } }] };
    expect(agentText(literal, "ar")).toContain("أحمد، وش وضع المزرعة؟");
    expect(agentText(literal, "ar")).not.toContain("العزبة");
  });
  it("ends a choice at one key press, and lets a quantity take several", () => {
    expect(twimlGather(session, "en", "/t")).toContain('numDigits="1"');
    expect(twimlGather({ ...session, inputMode: "number" }, "en", "/t")).not.toContain("numDigits");
    expect(twimlGather({ ...session, inputMode: "number" }, "en", "/t")).toContain('finishOnKey="#"');
    expect(twimlGather({ ...session, inputMode: "number" }, "en", "/t")).toContain('speechTimeout="2"');
    expect(twimlGather({ ...session, inputMode: "number" }, "en", "/t")).toContain("then press #");
    expect(twimlGather({ ...session, inputMode: "number" }, "ar", "/t")).toContain("ثم اضغط #");
  });

  it("uses the owner's farm wording in spoken Arabic", () => {
    const farm = { ...session, turns: [{ ...session.turns[0], text: { en: "farm", ar: "وش وضع المزرعة؟" } }] };
    expect(twimlGather(farm, "ar", "/t")).toContain("وش وضع العزبة؟");
  });

  it("plays the prompt inside Gather so input during the prompt is kept", () => {
    expect(twimlGather(session, "ar", "/t")).toMatch(/^<Response><Gather\b[^>]*><Say\b[^>]*>[^<]+<\/Say><\/Gather><\/Response>$/);
  });

  it("finishes the report summary before opening confirmation input", () => {
    expect(twimlGather({ ...session, step: "report_summary" }, "ar", "/t"))
      .toMatch(/^<Response><Say\b[^>]*>[^<]+<\/Say><Gather\b[^>]*><\/Gather><\/Response>$/);
  });

  it("escapes XML metacharacters in text and attributes", () => {
    expect(escapeXml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;");
    expect(sayElement(`عربي & < > " '`, "ar")).toContain("عربي &amp; &lt; &gt; &quot; &apos;");
  });

  it("uses the requested Arabic and English voice locales", () => {
    expect(sayElement("مرحبا", "ar")).toContain('voice="Polly.Zeina" language="arb"');
    expect(sayElement("Hello", "en")).toContain('voice="Polly.Joanna" language="en-US"');
  });

  it("creates Gather with speech, DTMF, language, a signed action URL, and options", () => {
    const xml = twimlGather(session, "en", "https://naqah.test/api/voice/turn?s=a.b&x=1");
    expect(xml).toContain('input="speech dtmf"');
    expect(xml).toContain('language="en-US"');
    expect(xml).toContain('numDigits="1"');
    expect(xml).toContain('action="https://naqah.test/api/voice/turn?s=a.b&amp;x=1"');
    expect(xml).toContain("Press 1 for Yes");
  });

  it("speaks everything before a POST redirect, and never hangs up first", () => {
    const xml = twimlSayThenRedirect("One. Two.", "en", "/api/voice/owner/heard?s=a.b&x=1");
    expect(xml).toMatch(/<\/Say><Redirect method="POST">\/api\/voice\/owner\/heard\?s=a\.b&amp;x=1<\/Redirect><\/Response>$/);
    expect(xml).not.toContain("<Hangup/>");
  });

  it("splits long text across Say elements at sentence ends, losing nothing", () => {
    const text = Array.from({ length: 60 }, (_, i) => `Detail number ${i} was recorded on the ranch today.`).join(" ");
    const xml = twimlSayThenRedirect(text, "en", "/x");
    const says = [...xml.matchAll(/<Say[^>]*>([\s\S]*?)<\/Say>/g)].map((m) => m[1]);
    expect(says.length).toBeGreaterThan(1);
    expect(says.every((chunk) => chunk.length <= 1_500)).toBe(true);
    expect(says.join(" ")).toBe(text);
  });

  it("ends politely with Hangup", () => {
    expect(twimlGoodbye("ar")).toMatch(/^<Response><Say[^>]*>يعطيك العافية\. مع السلامة\.<\/Say><Hangup\/><\/Response>$/);
  });
});
