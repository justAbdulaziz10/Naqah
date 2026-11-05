import type { Locale } from "@/domain/types";

const value = (name: string) => process.env[name]?.trim() ?? "";

export function voiceLocale(): Locale {
  return value("NAQAH_VOICE_LOCALE").toLowerCase() === "en" ? "en" : "ar";
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

  return {
    ok: true as const,
    voice: {
      configured: Boolean(voice.secret && voice.workerPhone),
      number: value("NEXT_PUBLIC_NAQAH_PHONE_NUMBER") || null,
    },
    whatsapp: {
      configured: Boolean(
        value("WHATSAPP_PHONE_NUMBER_ID") && value("WHATSAPP_TOKEN") && value("NAQAH_OWNER_WHATSAPP"),
      ),
    },
    ownerCall: {
      configured: value("NAQAH_CALL_OWNER") === "1" && twilioReady,
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
