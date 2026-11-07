import { cache, Suspense } from 'react';
import { readNavigationIdentity } from './navigation-actions';
import { AuthNavigationClient, AuthNavigationLoading, type AuthNavigationStyle } from './AuthNavigationClient';

// React cache deduplicates only within this server render/request, never across owners.
const requestIdentity = cache(readNavigationIdentity);

/** Request-only identity; never cache one owner's navigation in another owner's page. */
export async function ValidatedNavigation({ appearance }: { appearance: AuthNavigationStyle }) {
  const identity = await requestIdentity();
  return <AuthNavigationClient initialIdentity={identity} appearance={appearance} />;
}

export function AuthNavigation({ appearance = 'desktop' }: { appearance?: AuthNavigationStyle }) {
  return <Suspense fallback={<AuthNavigationLoading appearance={appearance} />}><ValidatedNavigation appearance={appearance} /></Suspense>;
}
