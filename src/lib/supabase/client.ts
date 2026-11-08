import { createBrowserClient } from '@supabase/ssr';
import { getSupabaseConfig, sessionCookieOptions } from './config';

export function createClient() {
  const config = getSupabaseConfig();
  return config ? createBrowserClient(config.url, config.key, { cookieOptions: sessionCookieOptions }) : null;
}
