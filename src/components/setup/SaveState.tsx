"use client";

import { useI18n } from "@/i18n/client";
import { useSaveStatus } from "@/store/workspace";

/** Reports the latest browser write. Shows nothing until something has actually been written. */
export function SaveState() {
  const { m } = useI18n();
  const status = useSaveStatus((state) => state.status);
  if (status === "idle") return null;
  return status === "saved" ? (
    <span role="status" className="text-xs font-medium text-muted">{m.common.actions.saved}</span>
  ) : (
    <span role="status" className="text-xs font-semibold text-danger">{m.common.actions.notSaved}</span>
  );
}
