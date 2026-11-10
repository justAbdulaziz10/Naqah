import "server-only";
import { REALTIME_TOOLS } from "@/server/voice/realtime/tools";
import type { LabPricing } from "@/components/voice-lab/usage";
import type { Locale } from "@/domain/types";
import { REALTIME_MODEL } from "../../../services/voice-bridge/config.mjs";

export const LAB_MODEL: string = REALTIME_MODEL;
export const LAB_MAX_SECONDS = 10 * 60;
const TRANSCRIBE_MODEL = "gpt-4o-transcribe";
/** The phone call's hint, without the farm's camel names. */
const TRANSCRIPTION_HINT: Record<Locale, string> = {
  ar: "مكالمة هاتف عن عزبة إبل باللهجة السعودية. كلمات متوقعة: الحلال، ناقة، النوق، علف، شعير، ماء، خزان، وايت، شبك، بيطري، زين، بخير، الحمد لله، كافي، خلص، باقي، إيه، صح، تمام، احفظ، ما أدري.",
  en: "A phone call about a camel ranch. Expected words: camels, feed, water, tank, fence, vet, fine, enough, yes, save.",
};
const API = "https://api.openai.com/v1/realtime/calls";
const CALL_ID = /^rtc_[\w-]{1,128}$/;

/** USD per 1M tokens, from OpenAI's pricing page (read 2026-11-08). Unknown models show tokens only. */
const PRICES: Record<string, LabPricing> = {
  "gpt-realtime-2.1": { textInput: 4, textCached: 0.4, textOutput: 24, audioInput: 32, audioCached: 0.4, audioOutput: 64, transcribeInput: 1.25, transcribeOutput: 5 },
};

export const labPricing = (): LabPricing | null => PRICES[LAB_MODEL] ?? null;

export type LabMode = "voice" | "text";

/** The phone call's settings, except the audio format WebRTC negotiates and the transcript the Lab shows. */
export function labSession(mode: LabMode, locale: Locale, instructions: string) {
  const base = { type: "realtime", model: LAB_MODEL, instructions, tools: REALTIME_TOOLS, tool_choice: "required", reasoning: { effort: "minimal" } };
  if (mode === "text") return { ...base, output_modalities: ["text"], audio: { input: { turn_detection: null } } };
  return {
    ...base,
    output_modalities: ["audio"],
    audio: {
      input: {
        transcription: { model: TRANSCRIBE_MODEL, language: locale, prompt: TRANSCRIPTION_HINT[locale] },
        turn_detection: { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 700, create_response: false, interrupt_response: false },
      },
      output: { voice: "marin" },
    },
  };
}

export type LabCall = { ok: true; answer: string; callId: string } | { ok: false; status: number; code: string };

/** The key never leaves this request: the browser only ever sees the SDP answer. */
export async function createLabCall(apiKey: string, sdp: string, session: object): Promise<LabCall> {
  const form = new FormData();
  form.set("sdp", sdp);
  form.set("session", JSON.stringify(session));
  let response: Response;
  try {
    response = await fetch(API, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form, redirect: "error", signal: AbortSignal.timeout(15_000) });
  } catch {
    return { ok: false, status: 0, code: "provider_unreachable" };
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { code?: unknown; type?: unknown } } | null;
    const code = [body?.error?.code, body?.error?.type].find((value) => typeof value === "string" && /^[\w.-]{1,64}$/.test(value));
    return { ok: false, status: response.status, code: (code as string | undefined) ?? "provider_error" };
  }
  const callId = response.headers.get("location")?.split("/").pop() ?? "";
  if (!CALL_ID.test(callId)) return { ok: false, status: 502, code: "provider_invalid" };
  return { ok: true, answer: await response.text(), callId };
}

export async function hangUpLabCall(apiKey: string, callId: string): Promise<void> {
  if (!CALL_ID.test(callId)) return;
  await fetch(`${API}/${callId}/hangup`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, redirect: "error", signal: AbortSignal.timeout(5_000) }).catch(() => undefined);
}
