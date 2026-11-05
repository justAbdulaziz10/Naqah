import { Suspense } from 'react';
import { redirect, notFound } from 'next/navigation';
import { connection } from 'next/server';
import { AuthFrame } from '@/components/auth/AuthFrame';
import { LogoutButton } from '@/components/auth/LogoutButton';
import { ButtonLink } from '@/components/ui';
import { isLocale } from '@/i18n/config';
import { auth } from '@/i18n/messages/auth';
import { getOwner } from '@/lib/supabase/server';
import { safeReturnPath } from '@/lib/supabase/auth-input';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ next?: string | string[] }> };
async function VerifiedOwner({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const m = auth[locale];
  // Session SDK background work reads the current time; run it only for a real request.
  await connection();
  const { user, unavailable } = await getOwner();
  const next = safeReturnPath((await searchParams).next);
  if (unavailable) return <AuthFrame><p role="alert">{m.unavailable}</p><ButtonLink href={`/${locale}/login`} className="mt-6">{m.login}</ButtonLink></AuthFrame>;
  if (!user) redirect(`/${locale}/login${next ? `?next=${encodeURIComponent(next)}` : ''}`);
  if (next) redirect(next);
  return <AuthFrame>
    <h1 className="text-2xl font-semibold">{m.signedIn}</h1>
    <p className="mt-3 leading-relaxed text-muted">{m.successBody}</p>
    <div className="mt-7 flex flex-col gap-4"><LogoutButton /><ButtonLink variant="ghost" href={`/${locale}`}>{m.home}</ButtonLink></div>
  </AuthFrame>;
}
export default function SuccessPage(props: Props) {
  return <Suspense fallback={null}><VerifiedOwner {...props} /></Suspense>;
}
