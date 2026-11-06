'use client';

import { unstable_rethrow } from 'next/navigation';
import { useState, useTransition } from 'react';
import { logout } from '@/app/[locale]/login/actions';
import { Button } from '@/components/ui';
import { useI18n } from '@/i18n/client';

export function LogoutButton() {
  const { locale, m: { auth: m } } = useI18n();
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  return <div>
    <Button variant="secondary" className="w-full" disabled={pending} size="lg" onClick={() => start(async () => {
      setFailed(false);
      try { const result = await logout(locale); setFailed(!!result?.failed); }
      // A successful logout rejects with the redirect, which Next must handle.
      catch (error) { unstable_rethrow(error); setFailed(true); }
    })}>{pending ? m.loggingOut : m.logout}</Button>
    {failed && <p role="alert" className="mt-3 text-danger">{m.failed}</p>}
  </div>;
}
