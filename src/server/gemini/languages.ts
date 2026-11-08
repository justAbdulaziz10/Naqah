import type { WorkerLanguage } from "@/domain/types";
import { isLiveCallLanguage, LIVE_CALL_LANGUAGES } from "@/lib/voice/liveCallLanguages";

/** Languages the Gemini text agent can understand and answer. Live phone support is separate. */
export const GEMINI_TEXT_LANGUAGES = ["ar", "en", "ur", "hi", "bn", "fil"] as const satisfies readonly WorkerLanguage[];

export function languageCapability(language: WorkerLanguage): { text: true; liveCall: boolean } {
  return { text: true, liveCall: isLiveCallLanguage(language) };
}

export { LIVE_CALL_LANGUAGES };
