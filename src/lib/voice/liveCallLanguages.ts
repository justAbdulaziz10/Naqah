import type { WorkerLanguage } from "@/domain/types";

/**
 * Worker languages the live phone line can speak today. Mirrors the server voice locale
 * (`NAQAH_VOICE_LOCALE`: ar or en, see `src/server/env.ts`). The owner may still choose any
 * language in `WORKER_LANGUAGES`; the others are saved but not yet available on live calls.
 * Update this list when the phone line gains a language.
 */
export const LIVE_CALL_LANGUAGES: readonly WorkerLanguage[] = ["ar", "en"];

export function isLiveCallLanguage(language: WorkerLanguage): boolean {
  return LIVE_CALL_LANGUAGES.includes(language);
}
