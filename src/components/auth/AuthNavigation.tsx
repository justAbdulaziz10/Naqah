import { Suspense } from 'react';
import { getOwner } from '@/lib/supabase/server';
import { AuthNavigationClient, type AuthNavigationStyle } from './AuthNavigationClient';

/** Request-only identity; never cache one owner's navigation in another owner's page. */
export async function ValidatedNavigation({ appearance }: { appearance: AuthNavigationStyle }) {
  const { user } = await getOwner();
  return <AuthNavigationClient initialOwnerId={user?.id ?? null} appearance={appearance} />;
}

export function AuthNavigation({ appearance = 'desktop' }: { appearance?: AuthNavigationStyle }) {
  return <Suspense fallback={null}><ValidatedNavigation appearance={appearance} /></Suspense>;
}
