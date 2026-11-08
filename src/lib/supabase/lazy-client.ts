import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseConfig } from './config';

let pending: Promise<SupabaseClient | null> | undefined;

/**
 * The browser client for pages that only watch the session (navigation, account sync). The SDK is a
 * large download, so it loads after the page renders and never on a deployment without Supabase.
 * Sign-in forms import `./client` directly: they need it at once.
 */
export function loadClient(): Promise<SupabaseClient | null> {
  if (!getSupabaseConfig()) return Promise.resolve(null);
  pending ??= import('./client').then(({ createClient }) => createClient()).catch(() => {
    pending = undefined;
    return null;
  });
  return pending;
}
