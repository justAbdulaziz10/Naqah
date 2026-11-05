'use server';

import { redirect } from 'next/navigation';
import { createWritableClient } from '@/lib/supabase/server';
import { isLocale } from '@/i18n/config';

export async function logout(locale: string): Promise<{ failed: true }> {
  if (!isLocale(locale)) return { failed: true };
  try {
    const client = await createWritableClient();
    if (!client) return { failed: true };
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) return { failed: true };
  } catch { return { failed: true }; }
  redirect(`/${locale}/login`);
}
