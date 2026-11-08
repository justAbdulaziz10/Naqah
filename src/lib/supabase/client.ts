import { createBrowserClient } from '@supabase/ssr';
import { getSupabaseConfig, sessionCookieOptionsFor } from './config';

export function createClient() {
  const config = getSupabaseConfig();
  return config ? createBrowserClient(config.url, config.key, { cookieOptions: sessionCookieOptionsFor(typeof window === 'undefined' ? null : window.location) }) : null;
}
