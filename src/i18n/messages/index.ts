import type { Locale } from "@/domain/types";
import { app } from "./app";
import { common } from "./common";
import { lab } from "./lab";
import { landing } from "./landing";
import { onboarding } from "./onboarding";

const all = { common, landing, onboarding, app, lab };

export function getMessages(locale: Locale) {
  return {
    common: all.common[locale],
    landing: all.landing[locale],
    onboarding: all.onboarding[locale],
    app: all.app[locale],
    lab: all.lab[locale],
  };
}

export type Messages = ReturnType<typeof getMessages>;
