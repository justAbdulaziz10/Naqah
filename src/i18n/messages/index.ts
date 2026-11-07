import type { Locale } from "@/domain/types";
import { account } from "./account";
import { app } from "./app";
import { auth } from "./auth";
import { common } from "./common";
import { lab } from "./lab";
import { landing } from "./landing";
import { onboarding } from "./onboarding";
import { setup } from "./setup";
import { calendar } from "./integrations/calendar";
import { phone } from "./integrations/phone";
import { pwa } from "./integrations/pwa";
import { section } from "./integrations/section";
import { weather } from "./integrations/weather";
import { whatsapp } from "./integrations/whatsapp";

const all = { common, landing, onboarding, setup, app, lab, auth, account };
const integrations = { section, pwa, calendar, whatsapp, weather, phone };

export function getMessages(locale: Locale) {
  return {
    common: all.common[locale],
    landing: all.landing[locale],
    onboarding: all.onboarding[locale],
    setup: all.setup[locale],
    app: all.app[locale],
    lab: all.lab[locale],
    auth: all.auth[locale],
    account: all.account[locale],
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
