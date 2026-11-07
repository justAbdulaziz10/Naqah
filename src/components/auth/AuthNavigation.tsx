import { cache, Suspense } from 'react';
import { readNavigationIdentity } from './navigation-actions';
import { AuthNavigationClient, AuthNavigationLoading, type AuthNavigationStyle } from './AuthNavigationClient';

// React cache deduplicates only within this server render/request, never across owners.
export const requestIdentity = cache(readNavigationIdentity);

/** Request-only identity; never cache one owner's navigation in another owner's page. */
export async function ValidatedNavigation({ appearance, signup }: { appearance: AuthNavigationStyle; signup?: boolean }) {
  const identity = await requestIdentity();
  return <AuthNavigationClient initialIdentity={identity} appearance={appearance} {...(signup === false ? { signup } : {})} />;
}

export function AuthNavigation({ appearance = 'desktop', signup }: { appearance?: AuthNavigationStyle; signup?: boolean }) {
  return <Suspense fallback={<AuthNavigationLoading appearance={appearance} />}><ValidatedNavigation appearance={appearance} {...(signup === false ? { signup } : {})} /></Suspense>;
}
