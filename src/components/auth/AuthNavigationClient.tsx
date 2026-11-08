'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/client';
import { observeAccountAuth } from '@/lib/account/auth-observer';
import { createClient } from '@/lib/supabase/client';
import { LogoutButton } from './LogoutButton';
import { createNavigationObserver, type NavigationIdentity } from './navigation-state';
import { readNavigationIdentity } from './navigation-actions';

const navigationObserver = createNavigationObserver({
  observe(changed) {
    const client = createClient();
    return client ? observeAccountAuth(client.auth, changed) : () => undefined;
  },
  validate: readNavigationIdentity,
});

export type AuthNavigationStyle = 'desktop' | 'mobile';
const styles = {
  desktop: 'inline-flex min-h-11 items-center px-3.5 text-[0.9375rem] font-semibold text-muted transition-colors hover:text-espresso',
  mobile: 'flex min-h-11 w-full items-center rounded-xl px-3.5 text-sm font-semibold text-espresso transition hover:bg-ivory focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current',
} as const;

export function AuthNavigationLoading({ appearance }: { appearance: AuthNavigationStyle }) {
  const { m } = useI18n();
  // Holds the sign-in link's exact width without drawing anything, so a slow or unavailable check never
  // shows a loading bar and the bar never shifts when the link arrives.
  return <span role="status" aria-label={m.auth.loading} aria-busy="true" className={styles[appearance]}>
    <span aria-hidden="true" className="invisible">{m.landing.nav.signIn}</span>
  </span>;
}

/** The validated owner identity, kept current by observed session hints. Shared by every auth-aware control. */
export function useNavigationIdentity(initialIdentity: NavigationIdentity): NavigationIdentity {
  const [identity, setIdentity] = useState(initialIdentity);
  useEffect(() => {
    return navigationObserver.subscribe(initialIdentity, setIdentity);
  }, [initialIdentity]);
  return identity;
}

/** Observed session hints trigger server validation; workspace/demo state is never consulted. */
export function AuthNavigationClient({ initialIdentity, appearance, signup = true }: {
  initialIdentity: NavigationIdentity;
  appearance: AuthNavigationStyle;
  /** Off where the page's own primary action already starts sign-up. */
  signup?: boolean;
}) {
  const { href, m } = useI18n();
  const identity = useNavigationIdentity(initialIdentity);
  const className = styles[appearance];
  if (identity.status === 'unknown') return <AuthNavigationLoading appearance={appearance} />;
  if (identity.status === 'signedIn') return <LogoutButton navigationClassName={className} />;
  const closeMenu = (event: React.MouseEvent<HTMLAnchorElement>) => event.currentTarget.closest('details')?.removeAttribute('open');
  return <>
    <Link className={className} href={`${href('/login')}?next=${encodeURIComponent(href('/app'))}`} onClick={closeMenu}>{m.landing.nav.signIn}</Link>
    {signup ? <Link className={className} href={`${href('/signup')}?next=${encodeURIComponent(href('/start'))}`} onClick={closeMenu}>{m.auth.navSignup}</Link> : null}
  </>;
}
