"use client";

import { useI18n } from "@/i18n/client";

/** Placeholder — owned by the onboarding slice. */
export default function Page() {
  const { m } = useI18n();
  return <h1 className="p-8 text-2xl font-bold">{m.common.actions.setUp}</h1>;
}
