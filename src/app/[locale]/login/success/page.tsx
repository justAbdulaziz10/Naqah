import type { Metadata } from 'next';
import { Suspense } from 'react';
import { redirect, notFound } from 'next/navigation';
import { AuthFrame, AuthHeading } from '@/components/auth/AuthFrame';
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
  if (unavailable) return <AuthFrame><p role="alert" className="leading-relaxed">{m.unavailable}</p><ButtonLink size="lg" href={`/${locale}/login`} className="mt-6 w-full">{m.emailLogin}</ButtonLink></AuthFrame>;
  if (!user) redirect(`/${locale}/login${next ? `?next=${encodeURIComponent(next)}` : ''}`);
  if (next) redirect(next);
  // With account data on, the dashboard decides between setup and the farm: no extra stop here.
  if (process.env.NEXT_PUBLIC_NAQAH_ACCOUNT_DATA === '1') redirect(`/${locale}/app`);
  return <AuthFrame>
    <AuthHeading title={m.signedIn} lead={m.successBody} />
    <div className="mt-7 flex flex-col gap-3"><ButtonLink size="lg" href={`/${locale}/app`}>{m.continue}</ButtonLink><LogoutButton /><ButtonLink variant="ghost" href={`/${locale}`}>{m.home}</ButtonLink></div>
  </AuthFrame>;
}
export default function SuccessPage(props: Props) {
  return <Suspense fallback={null}><VerifiedOwner {...props} /></Suspense>;
}
