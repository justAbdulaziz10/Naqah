'use client';

import { unstable_rethrow } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { logout } from '@/app/[locale]/login/actions';
import { Button, ConfirmDialog } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { accountSync } from '@/store/account';

/**
 * Logs out without ever dropping an owner's edit silently: pending changes are saved first, and if
 * that fails (or an edit on screen can't be sent yet) the owner chooses to retry, stay or discard.
 */
export function LogoutButton({ navigationClassName }: { navigationClassName?: string } = {}) {
  const { locale, m } = useI18n();
  const a = m.auth;
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  const signOut = () => start(async () => {
    setFailed(false);
    setUnsaved(false);
    try { const result = await logout(locale); setFailed(!!result?.failed); }
    // A successful logout rejects with the redirect, which Next must handle.
    catch (error) {
      try { unstable_rethrow(error); } catch (redirect) { accountSync.close(); throw redirect; }
      setFailed(true);
    }
  });

  async function attempt() {
    if (accountSync.hasUnsaved()) {
      setSaving(true);
      try { await accountSync.flush(); } catch { /* Reported through hasUnsaved below. */ }
      setSaving(false);
      if (accountSync.hasUnsaved()) {
        setUnsaved(true);
        return;
      }
    }
    signOut();
  }

  function stay() {
    setUnsaved(false);
    requestAnimationFrame(() => trigger.current?.focus());
  }

  const label = saving ? m.account.logoutSaving : pending ? a.loggingOut : a.logout;
  const busy = pending || saving;
  return <div>
    {navigationClassName ? <button ref={trigger} type="button" className={navigationClassName} disabled={busy} onClick={() => void attempt()}>{label}</button>
      : <Button ref={trigger} variant="secondary" className="w-full" disabled={busy} size="lg" onClick={() => void attempt()}>{label}</Button>}
    {unsaved ? (
      <ConfirmDialog
        title={m.account.logoutUnsavedTitle}
        body={m.account.logoutUnsaved}
        cancelLabel={m.account.logoutStay}
        confirmLabel={m.account.logoutRetry}
        tone="primary"
        onCancel={stay}
        onConfirm={() => { setUnsaved(false); void attempt(); }}
        extra={{ label: m.account.logoutDiscard, onClick: signOut }}
      />
    ) : null}
    {failed && <p role="alert" className="mt-3 text-danger">{a.failed}</p>}
  </div>;
}
