import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { geminiModel } from "@/server/env";
import { interpretationSchema } from "./schema";

export const geminiResponseConfig = {
  responseMimeType: "application/json" as const,
  responseJsonSchema: interpretationSchema,
};

/**
 * Gemini 3.5 Flash is deprecated and routed onward, and its default thinking
 * level ran past the 8s call budget. 3.6 Flash is the supported replacement and
 * accepts MINIMAL. 3.7 and 3.8 reject MINIMAL, so they get LOW. Gemini 2 uses a
 * token budget of 0; sending that budget to Gemini 3 can return HTTP 400.
 */
export function geminiThinkingConfig(model = geminiModel()): { thinkingLevel: ThinkingLevel } | { thinkingBudget: 0 } {
  if (/^gemini-2(?:\.|$)/.test(model)) return { thinkingBudget: 0 };
  if (/^gemini-3\.[78](?:-|$)/.test(model)) return { thinkingLevel: ThinkingLevel.LOW };
  return { thinkingLevel: ThinkingLevel.MINIMAL };
}

export type GeminiFailure =
  | "bad_request"
  | "authentication"
  | "permission"
  | "model_not_found"
  | "quota"
  | "provider"
  | "network"
  | "timeout"
  | "invalid"
  | "unavailable";

const PROVIDER_CODES = new Set([
  "INVALID_ARGUMENT",
  "FAILED_PRECONDITION",
  "UNAUTHENTICATED",
  "PERMISSION_DENIED",
  "NOT_FOUND",
  "RESOURCE_EXHAUSTED",
  "INTERNAL",
  "UNAVAILABLE",
  "DEADLINE_EXCEEDED",
]);

export class GeminiError extends Error {
  constructor(
    readonly code: GeminiFailure,
    readonly status: number | null = null,
    readonly providerCode: string | null = null,
  ) {
    super(code);
    this.name = "GeminiError";
  }
}

export interface GeminiClient {
  generate(prompt: string): Promise<string>;
}

/**
 * The farm webhook aborts at 12s because Twilio stops at 15s
 * (`WEBHOOK_LIMIT_MS` in farm-webhook.ts), and the save still needs time after this returns.
 * A fast provider failure may take one more attempt inside this same budget.
 */
export const GEMINI_TIMEOUT_MS = 8_000;

function httpStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("status" in error)) return null;
  const status = error.status;
  return typeof status === "number" && status >= 400 && status <= 599 ? status : null;
}

/** Only a known Google status token. Free-text messages are not scanned. */
function providerCode(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  try {
    const body = JSON.parse(error.message) as { error?: { status?: unknown } };
    const status = body.error?.status;
    return typeof status === "string" && PROVIDER_CODES.has(status) ? status : null;
  } catch {
    return null;
  }
}

function isTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "TimeoutError" || error.name === "AbortError") return true;
  const cause = "cause" in error ? error.cause : undefined;
  const code = typeof cause === "object" && cause !== null && "code" in cause ? cause.code : "";
  return code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT";
}

function isNetwork(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    const code = "code" in current && typeof current.code === "string" ? current.code : "";
    if (/^(ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ECONNABORTED|EHOSTUNREACH|ENETUNREACH|EPIPE|ERR_TLS|CERT_|UNABLE_TO_VERIFY)/.test(code)) return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return error instanceof TypeError && error.message === "fetch failed";
}

function fromStatus(status: number, code: string | null): GeminiError {
  if (status === 400) return new GeminiError("bad_request", status, code);
  if (status === 401) return new GeminiError("authentication", status, code);
  if (status === 403) return new GeminiError("permission", status, code);
  if (status === 404) return new GeminiError("model_not_found", status, code);
  if (status === 429) return new GeminiError("quota", status, code);
  if (status >= 500) return new GeminiError("provider", status, code);
  return new GeminiError("unavailable", status, code);
}

export function classifyGeminiFailure(error: unknown): GeminiError {
  if (error instanceof GeminiError) return error;
  if (isTimeout(error)) return new GeminiError("timeout", httpStatus(error), providerCode(error));
  const status = httpStatus(error);
  if (status !== null) return fromStatus(status, providerCode(error));
  if (isNetwork(error)) return new GeminiError("network");
  return new GeminiError("unavailable");
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type GeminiCall = (timeoutMs: number) => Promise<string>;

/**
 * One provider retry, and only when the first failure was fast enough to leave
 * another attempt inside the same call budget. Quota, auth, and timeouts are not retried.
 */
export async function requestGemini(
  timeoutMs: number,
  call: GeminiCall,
  sleep: (ms: number) => Promise<void> = pause,
): Promise<string> {
  const started = Date.now();
  try {
    return await call(timeoutMs);
  } catch (error) {
    const classified = classifyGeminiFailure(error);
    const remaining = timeoutMs - (Date.now() - started);
    if (classified.code !== "provider" || remaining < 2_500) throw classified;
    const wait = Math.min(400, remaining - 2_000);
    await sleep(wait);
    try {
      return await call(remaining - wait);
    } catch (retryError) {
      throw classifyGeminiFailure(retryError);
    }
  }
}

/** One bounded JSON request, plus a single fast provider retry. The prompt and response are not logged. */
export async function generateWithGemini(prompt: string, timeoutMs = GEMINI_TIMEOUT_MS): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY?.trim() ?? "";
  if (!apiKey) throw new GeminiError("unavailable");
  const ai = new GoogleGenAI({ apiKey });
  return requestGemini(timeoutMs, async (budget) => {
    const response = await ai.models.generateContent({
      model: geminiModel(),
      contents: prompt,
      config: {
        ...geminiResponseConfig,
        thinkingConfig: geminiThinkingConfig(),
        abortSignal: AbortSignal.timeout(budget),
      },
    });
    if (!response.text) throw new GeminiError("invalid");
    return response.text;
  });
}

export function liveGeminiClient(): GeminiClient {
  return { generate: (prompt) => generateWithGemini(prompt) };
}
