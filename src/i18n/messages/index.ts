import type { Locale } from "@/domain/types";
import { app } from "./app";
import { common } from "./common";
import { lab } from "./lab";
import { landing } from "./landing";
import { onboarding } from "./onboarding";
import { welcome } from "./welcome";
import { calendar } from "./integrations/calendar";
import { phone } from "./integrations/phone";
import { pwa } from "./integrations/pwa";
import { section } from "./integrations/section";
import { weather } from "./integrations/weather";
import { whatsapp } from "./integrations/whatsapp";

const all = { common, landing, welcome, onboarding, app, lab };
const integrations = { section, pwa, calendar, whatsapp, weather, phone };

export function getMessages(locale: Locale) {
  return {
    common: all.common[locale],
    landing: all.landing[locale],
    welcome: all.welcome[locale],
    onboarding: all.onboarding[locale],
    app: all.app[locale],
    lab: all.lab[locale],
    integrations: {
      section: integrations.section[locale],
      pwa: integrations.pwa[locale],
      calendar: integrations.calendar[locale],
      whatsapp: integrations.whatsapp[locale],
      weather: integrations.weather[locale],
      phone: integrations.phone[locale],
    },
  };
}

export type Messages = ReturnType<typeof getMessages>;
