import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendWhatsAppText, whatsappPayload } from "./cloud";

describe("WhatsApp Cloud API summaries", () => {
  beforeEach(() => {
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "phone-id");
    vi.stubEnv("WHATSAPP_TOKEN", "test-token");
    vi.stubEnv("NAQAH_OWNER_WHATSAPP", "+966511111111");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends a text payload with Bearer authentication", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendWhatsAppText("+966511111111", "Saved report")).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v21.0/phone-id/messages");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer test-token");
    expect(JSON.parse(String(init.body))).toEqual({
      messaging_product: "whatsapp", to: "+966511111111", type: "text",
      text: { preview_url: false, body: "Saved report" },
    });
  });

  it("uses an optional template with the summary as its body parameter", () => {
    vi.stubEnv("WHATSAPP_TEMPLATE_NAME", "naqah_summary");
    vi.stubEnv("WHATSAPP_TEMPLATE_LANGUAGE", "ar");
    expect(whatsappPayload("+966511111111", "ملخص التقرير")).toEqual({
      messaging_product: "whatsapp", to: "+966511111111", type: "template",
      template: {
        name: "naqah_summary", language: { code: "ar" },
        components: [{ type: "body", parameters: [{ type: "text", text: "ملخص التقرير" }] }],
      },
    });
  });

  it("degrades when credentials are missing or the provider rejects the message", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("WHATSAPP_TOKEN", "");
    expect(await sendWhatsAppText("+966511111111", "summary")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.stubEnv("WHATSAPP_TOKEN", "test-token");
    expect(await sendWhatsAppText("+966511111111", "summary")).toBe(false);
  });
});
