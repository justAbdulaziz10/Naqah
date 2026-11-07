'use server';

import { getOwner } from '@/lib/supabase/server';
import { navigationIdentity, type NavigationIdentity } from './navigation-state';

/** Read-only identity validation; no user profile, token or cookie is returned. */
export async function readNavigationIdentity(): Promise<NavigationIdentity> {
  return navigationIdentity(await getOwner());
}
