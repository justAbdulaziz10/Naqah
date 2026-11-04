"use client";

import { useI18n } from "@/i18n/client";

/** Placeholder — owned by the dashboard slice. */
export default function Page() {
  const { m } = useI18n();
  return <h1 className="text-2xl font-bold">{m.common.nav.herd}</h1>;
}
