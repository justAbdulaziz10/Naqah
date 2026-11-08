'use client';

import { unstable_rethrow } from 'next/navigation';
import { useState, useTransition } from 'react';
import { logout } from '@/app/[locale]/login/actions';
import { Button } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { accountSync } from '@/store/account';

export function LogoutButton({ navigationClassName }: { navigationClassName?: string } = {}) {
  const { locale, m: { auth: m } } = useI18n();
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  const onClick = () => start(async () => {
      setFailed(false);
      try { const result = await logout(locale); setFailed(!!result?.failed); }
      // A successful logout rejects with the redirect, which Next must handle.
      catch (error) {
        try { unstable_rethrow(error); } catch (redirect) { accountSync.close(); throw redirect; }
        setFailed(true);
      }
    });
  const label = pending ? m.loggingOut : m.logout;
  return <div>
    {navigationClassName ? <button type="button" className={navigationClassName} disabled={pending} onClick={onClick}>{label}</button>
      : <Button variant="secondary" className="w-full" disabled={pending} size="lg" onClick={onClick}>{label}</Button>}
    {failed && <p role="alert" className="mt-3 text-danger">{m.failed}</p>}
  </div>;
}
