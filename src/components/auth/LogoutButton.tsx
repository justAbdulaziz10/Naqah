'use client';

import { useState, useTransition } from 'react';
import { logout } from '@/app/[locale]/login/actions';
import { Button } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { auth } from '@/i18n/messages/auth';

export function LogoutButton() {
  const { locale } = useI18n();
  const m = auth[locale];
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  return <div>
    <Button disabled={pending} size="lg" onClick={() => start(async () => {
      setFailed(false);
      try { const result = await logout(locale); setFailed(!!result?.failed); }
      catch { setFailed(true); }
    })}>{pending ? m.loggingOut : m.logout}</Button>
    {failed && <p role="alert" className="mt-3 text-danger">{m.failed}</p>}
  </div>;
}
