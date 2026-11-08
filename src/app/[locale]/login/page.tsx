import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthEntry, type AuthEntryProps } from '@/components/auth/AuthEntry';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/messages';

export async function generateMetadata({ params }: PageProps<'/[locale]/login'>): Promise<Metadata> {
  const { locale } = await params;
  return { title: getMessages(isLocale(locale) ? locale : 'ar').auth.login, robots: { index: false } };
}

export default function LoginPage(props: AuthEntryProps) {
  return <Suspense fallback={null}><AuthEntry {...props} mode="login" /></Suspense>;
}
