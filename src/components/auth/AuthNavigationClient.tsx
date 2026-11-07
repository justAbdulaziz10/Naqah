'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/client';
import { observeAccountAuth } from '@/lib/account/auth-observer';
import { createClient } from '@/lib/supabase/client';
import { LogoutButton } from './LogoutButton';

export type AuthNavigationStyle = 'desktop' | 'mobile' | 'welcome';
const styles = {
  desktop: 'inline-flex min-h-11 items-center px-3.5 text-[0.9375rem] font-semibold text-muted transition-colors hover:text-espresso',
  mobile: 'flex min-h-11 w-full items-center rounded-xl px-3.5 text-sm font-semibold text-espresso transition hover:bg-ivory focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current',
  welcome: 'inline-flex min-h-11 items-center px-2 text-[0.9375rem] font-semibold text-muted transition-colors hover:text-espresso',
} as const;

/** A session hint updates controls only; server getOwner/RLS still authorize every operation. */
export function AuthNavigationClient({ initialOwnerId, appearance }: { initialOwnerId: string | null; appearance: AuthNavigationStyle }) {
  const { href, m } = useI18n();
  const [ownerId, setOwnerId] = useState(initialOwnerId);
  useEffect(() => {
    const client = createClient();
    if (!client) return;
    return observeAccountAuth(client.auth, setOwnerId);
  }, []);
  const className = styles[appearance];
  if (ownerId) return <LogoutButton navigationClassName={className} />;
  const closeMenu = (event: React.MouseEvent<HTMLAnchorElement>) => event.currentTarget.closest('details')?.removeAttribute('open');
  return <>
    <Link className={className} href={`${href('/login')}?next=${encodeURIComponent(href('/app'))}`} onClick={closeMenu}>{m.landing.nav.signIn}</Link>
    <Link className={className} href={`${href('/signup')}?next=${encodeURIComponent(href('/start'))}`} onClick={closeMenu}>{m.auth.navSignup}</Link>
  </>;
}
