"use client";

import { CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { useI18n } from "@/i18n/client";
import { useUnsentDrafts } from "@/store/accountSync";
import { useIsAccount, useSaveStatus } from "@/store/workspace";
import "./onboarding/onboarding.css";

/**
 * Reports the latest write (to the browser, or to the account). Shows nothing until something has
 * actually been written, and never "saved" while an edit on the screen still can't be sent.
 */
export function SaveState() {
  const { m } = useI18n();
  const status = useSaveStatus((state) => state.status);
  const account = useIsAccount();
  const unsent = useUnsentDrafts((state) => state.fields.length > 0) && account;
  if (status === "idle" && !unsent) return null;
  return status === "saved" && !unsent ? (
    <span role="status" className="naqah-saved-in inline-flex items-center gap-1.5 text-sm font-semibold text-ok">
      {/* Each write remounts this mark (the status passes through idle), so it pops once per save. */}
      <CheckCircle size={16} weight="fill" className="naqah-done" aria-hidden />
      {account ? m.setup.settings.saved : m.common.actions.saved}
    </span>
  ) : (
    <span role="status" className="naqah-saved-in inline-flex items-center gap-1.5 text-sm font-semibold text-danger">
      <WarningCircle size={16} weight="fill" aria-hidden />
      {unsent ? m.account.unsent : m.common.actions.notSaved}
    </span>
  );
}
