import { summaryCredentials } from "@/server/env";

interface WhatsAppPayload {
  messaging_product: "whatsapp";
  to: string;
  type: "text" | "template";
  text?: { preview_url: false; body: string };
  template?: {
    name: string;
    language: { code: string };
    components: { type: "body"; parameters: { type: "text"; text: string }[] }[];
  };
}

export function whatsappPayload(to: string, body: string): WhatsAppPayload | null {
  const config = summaryCredentials().whatsapp;
  if (config.templateName) {
    const lines = body
      .split(/\r\n|\r|\n|\u2028|\u2029/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const normalized = capWithEllipsis(lines.join(" • "), 1_000);
    return {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: config.templateName,
        language: { code: config.templateLanguage },
        components: [{ type: "body", parameters: [{ type: "text", text: normalized }] }],
      },
    };
  }
  return {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { preview_url: false, body: capWithEllipsis(body, 4_096) },
  };
}

function capWithEllipsis(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

export async function sendWhatsAppText(to: string, body: string): Promise<boolean> {
  const config = summaryCredentials().whatsapp;
  if (!config.token || !config.phoneNumberId || !to || typeof fetch !== "function") return false;
  const payload = whatsappPayload(to, body);
  if (!payload) return false;
  try {
    const response = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(config.phoneNumberId)}/messages`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    console.info(`[NAQAH] WhatsApp owner summary ${response.ok ? "accepted" : `failed (${response.status})`}`);
    return response.ok;
  } catch {
    console.info("[NAQAH] WhatsApp owner summary failed (network error)");
    return false;
  }
}
