import type { Locale } from "@/domain/types";
import { callAllowlist, manualCallsEnabled, outboundCallMissing, scheduledCallsEnabled } from "@/server/calls/config";

const value = (name: string) => process.env[name]?.trim() ?? "";

export function voiceLocale(): Locale {
  return value("NAQAH_VOICE_LOCALE").toLowerCase() === "en" ? "en" : "ar";
}

export function voiceSignatureValidationEnabled(): boolean {
  return Boolean(value("TWILIO_AUTH_TOKEN"));
}

export function shouldRefuseUnsignedVoice(): boolean {
  const production = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
  return production && process.env.NAQAH_ALLOW_UNSIGNED_VOICE !== "1" && !voiceSignatureValidationEnabled();
}

/** `farm` is a real call on a real farm. Anything else is the sample line, which saves nothing. */
export function voiceMode(): "farm" | "sample" {
  return value("NAQAH_VOICE_MODE").toLowerCase() === "farm" ? "farm" : "sample";
}

/** Names only, so it is safe to log. Farm calls need every one of these. */
export function farmVoiceMissing(): string[] {
  // Legacy names for the same Supabase keys count too (see src/lib/supabase/config.ts).
  const legacy: Record<string, string> = {
    SUPABASE_SECRET_KEY: "SUPABASE_SERVICE_ROLE_KEY",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  };
  return ["TWILIO_AUTH_TOKEN", "NAQAH_PUBLIC_BASE_URL", "SUPABASE_SECRET_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]
    .filter((name) => !value(name) && !(legacy[name] && value(legacy[name])));
}

/** Caller ID can be spoofed and an inquiry reads farm data aloud, so it stays off until decided. */
export function voiceOwnerInquiryEnabled(): boolean {
  return value("NAQAH_VOICE_OWNER_INQUIRY") === "1";
}

/** Server-only model name. The key itself is read by the Gemini client and is never returned. */
export function geminiModel(): string {
  return value("GEMINI_MODEL") || "gemini-3.6-flash";
}

export function geminiConfigured(): boolean {
  return Boolean(value("GEMINI_API_KEY"));
}

export function voiceConfiguration() {
  return {
    secret: value("NAQAH_VOICE_SECRET"),
    workerPhone: value("NAQAH_WORKER_PHONE"),
    ownerPhone: value("NAQAH_OWNER_PHONE"),
    locale: voiceLocale(),
    arabicVoice: value("NAQAH_VOICE_ARABIC_VOICE") || "Polly.Zeina",
    englishVoice: value("NAQAH_VOICE_ENGLISH_VOICE") || "Polly.Joanna",
  };
}

export function integrationsStatus() {
  const voice = voiceConfiguration();
  const twilioReady = Boolean(
    value("TWILIO_ACCOUNT_SID") &&
      value("TWILIO_AUTH_TOKEN") &&
      value("TWILIO_PHONE_NUMBER") &&
      voice.ownerPhone,
  );

  const mode = voiceMode();

  return {
    ok: true as const,
    voice: {
      mode,
      configured: mode === "farm" ? !farmVoiceMissing().length : Boolean(voice.secret && voice.workerPhone),
      number: value("NEXT_PUBLIC_NAQAH_PHONE_NUMBER") || null,
      signatureValidation: voiceSignatureValidationEnabled(),
    },
    // Summaries go to one number from the environment, so they exist on the sample line only:
    // a real farm's report must reach that farm's owner.
    whatsapp: {
      configured: mode === "sample" && Boolean(
        value("WHATSAPP_PHONE_NUMBER_ID") && value("WHATSAPP_TOKEN") && value("NAQAH_OWNER_WHATSAPP"),
      ),
    },
    ownerCall: {
      configured: mode === "sample" && value("NAQAH_CALL_OWNER") === "1" && twilioReady,
    },
    // Calls NAQAH places to workers. Flags and counts only, never numbers or secrets.
    outbound: {
      configured: mode === "farm" && !farmVoiceMissing().length && !outboundCallMissing().length,
      manualCalls: manualCallsEnabled(),
      scheduledCalls: scheduledCallsEnabled(),
      allowlistedNumbers: callAllowlist()?.length ?? null,
    },
  };
}

export function summaryCredentials() {
  const voice = voiceConfiguration();
  const ownerWhatsApp = value("NAQAH_OWNER_WHATSAPP");

  return {
    whatsapp: {
      token: value("WHATSAPP_TOKEN"),
      phoneNumberId: value("WHATSAPP_PHONE_NUMBER_ID"),
      recipient: ownerWhatsApp,
      templateName: value("WHATSAPP_TEMPLATE_NAME"),
      templateLanguage: value("WHATSAPP_TEMPLATE_LANGUAGE") || "ar",
    },
    ownerCall: {
      enabled: value("NAQAH_CALL_OWNER") === "1",
      accountSid: value("TWILIO_ACCOUNT_SID"),
      authToken: value("TWILIO_AUTH_TOKEN"),
      from: value("TWILIO_PHONE_NUMBER"),
      to: voice.ownerPhone,
      arabicVoice: voice.arabicVoice,
      englishVoice: voice.englishVoice,
    },
  };
}
