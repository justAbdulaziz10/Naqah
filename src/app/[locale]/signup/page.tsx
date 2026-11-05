import type { Metadata } from 'next';
import { Suspense } from 'react';
import { OwnerAuth } from '@/components/auth/OwnerAuth';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/messages';

export async function generateMetadata({ params }: PageProps<'/[locale]/signup'>): Promise<Metadata> {
  const { locale } = await params;
  return { title: getMessages(isLocale(locale) ? locale : 'ar').auth.signup, robots: { index: false } };
}

export default function SignupPage() {
  return <Suspense fallback={null}><OwnerAuth mode="signup" /></Suspense>;
}
