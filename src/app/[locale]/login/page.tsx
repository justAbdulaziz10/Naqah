import type { Metadata } from 'next';
import { Suspense } from 'react';
import { OwnerAuth } from '@/components/auth/OwnerAuth';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/messages';

export async function generateMetadata({ params }: PageProps<'/[locale]/login'>): Promise<Metadata> {
  const { locale } = await params;
  return { title: getMessages(isLocale(locale) ? locale : 'ar').auth.login, robots: { index: false } };
}

export default function LoginPage() {
  return <Suspense fallback={null}><OwnerAuth mode="login" /></Suspense>;
}
