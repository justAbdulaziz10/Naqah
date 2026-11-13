import type { Metadata } from 'next';
import { Suspense } from 'react';
import { redirect, notFound } from 'next/navigation';
import { AuthFrame } from '@/components/auth/AuthFrame';
import { LogoutButton } from '@/components/auth/LogoutButton';
import { ButtonLink } from '@/components/ui';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/messages';
import { getOwner } from '@/lib/supabase/server';
import { safeReturnPath } from '@/lib/supabase/auth-input';

export async function generateMetadata({ params }: PageProps<'/[locale]/login/success'>): Promise<Metadata> {
  const { locale } = await params;
  return { title: getMessages(isLocale(locale) ? locale : 'ar').auth.signedIn, robots: { index: false } };
}

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ next?: string | string[] }> };
async function VerifiedOwner({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const m = getMessages(locale).auth;
  const { user, unavailable } = await getOwner();
  const next = safeReturnPath((await searchParams).next);
  if (unavailable) return <AuthFrame><p role="alert">{m.unavailable}</p><ButtonLink href={`/${locale}/login`} className="mt-6">{m.login}</ButtonLink></AuthFrame>;
  if (!user) redirect(`/${locale}/login${next ? `?next=${encodeURIComponent(next)}` : ''}`);
  if (next) redirect(next);
  return <AuthFrame>
    <h1 className="text-2xl font-semibold">{m.signedIn}</h1>
    {process.env.NEXT_PUBLIC_NAQAH_ACCOUNT_DATA === '1' ? null : <p className="mt-3 leading-relaxed text-muted">{m.successBody}</p>}
    <div className="mt-7 flex flex-col gap-4"><ButtonLink size="lg" href={`/${locale}/app`}>{m.continue}</ButtonLink><LogoutButton /><ButtonLink variant="ghost" href={`/${locale}`}>{m.home}</ButtonLink></div>
  </AuthFrame>;
}
export default function SuccessPage(props: Props) {
  return <Suspense fallback={null}><VerifiedOwner {...props} /></Suspense>;
}
