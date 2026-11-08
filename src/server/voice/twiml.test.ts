import { describe, expect, it } from "vitest";
import type { CallSession } from "@/domain/conversation/engine";
import { escapeXml, sayElement, twimlGather, twimlGoodbye } from "./twiml";

const session: CallSession = {
  scenario: "worker_report", step: "confirm",
  turns: [{ speaker: "agent", text: { en: "Say & confirm", ar: "قل نعم" }, at: "2026-01-01T00:00:00.000Z" }],
  replies: [{ id: "yes", value: "yes", label: { en: "Yes", ar: "نعم" } }],
  inputMode: "choices", done: false, startedAt: "2026-01-01T00:00:00.000Z",
  draft: { answers: [], camelUpdates: [], resourceUpdates: [], herdAccountedFor: null, taskConfirmations: [] }, data: {}, notices: [],
};

describe("TwiML output", () => {
  it("ends a choice at one key press, and lets a quantity take several", () => {
    expect(twimlGather(session, "en", "/t")).toContain('numDigits="1"');
    expect(twimlGather({ ...session, inputMode: "number" }, "en", "/t")).not.toContain("numDigits");
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

  it("ends politely with Hangup", () => {
    expect(twimlGoodbye("ar")).toMatch(/^<Response><Say[^>]*>يعطيك العافية\. مع السلامة\.<\/Say><Hangup\/><\/Response>$/);
  });
});
