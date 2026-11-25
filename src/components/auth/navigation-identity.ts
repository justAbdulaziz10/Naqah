'use client';

import { useEffect, useState } from 'react';
import { ACCOUNT_DATA } from '@/components/entry/paths';
import { observeAccountAuth } from '@/lib/account/auth-observer';
import { loadClient } from '@/lib/supabase/lazy-client';
import { readNavigationIdentity } from './navigation-actions';
import { createNavigationObserver, type NavigationIdentity } from './navigation-state';

/*
 * Kept apart from the sign-in and logout controls so public pages (the landing's actions) can follow the
 * owner's identity without loading the logout dialog, the account store or the sample ranch.
 */
const navigationObserver = createNavigationObserver({
  observe(changed) {
    // Without accounts there is no session to watch: never download the Supabase SDK on public pages.
    if (!ACCOUNT_DATA) return () => {};
    let stop: (() => void) | undefined;
    let disposed = false;
    void loadClient().then((client) => {
      if (!disposed && client) stop = observeAccountAuth(client.auth, changed);
    });
    return () => {
      disposed = true;
      stop?.();
    };
  },
  validate: readNavigationIdentity,
});

/** The validated owner identity, kept current by observed session hints. Shared by every auth-aware control. */
export function useNavigationIdentity(initialIdentity: NavigationIdentity): NavigationIdentity {
  const [identity, setIdentity] = useState(initialIdentity);
  useEffect(() => {
    return navigationObserver.subscribe(initialIdentity, setIdentity);
  }, [initialIdentity]);
  return identity;
}
