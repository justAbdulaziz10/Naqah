import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { connection } from 'next/server';
import { getSupabaseConfig, sessionCookieOptions } from './config';
import { withTimeout } from './timeout';

const OWNER_CHECK_TIMEOUT_MS = 3_000;

export async function createClient() {
  const config = getSupabaseConfig();
  if (!config) return null;
  const store = await cookies();
  return createServerClient(config.url, config.key, {
    cookieOptions: sessionCookieOptions,
    cookies: {
      getAll: () => store.getAll(),
      setAll(values) {
        // Server Components cannot write cookies; the proxy refreshes them.
        // Actions and route handlers must use the writable helper below.
        try { values.forEach(({ name, value, options }) => store.set(name, value, options)); }
        catch { /* Read-only render context. */ }
      },
    },
  });
}

/** Fresh Auth-server validation, including revoked sessions. Never use getSession for authorization. */
export async function getOwner() {
  await connection(); // auth-js reads the clock, which Cache Components only allows at request time.
  const client = await createClient();
  if (!client) return { user: null, unavailable: true };
  try {
    const { data, error } = await withTimeout(client.auth.getUser(), OWNER_CHECK_TIMEOUT_MS);
    return { user: error ? null : data.user, unavailable: !!error && error.status !== 401 && error.status !== 403 && error.name !== 'AuthSessionMissingError' };
  } catch { return { user: null, unavailable: true }; }
}

export async function createWritableClient() {
  const config = getSupabaseConfig();
  if (!config) return null;
  const store = await cookies();
  return createServerClient(config.url, config.key, {
    cookieOptions: sessionCookieOptions,
    cookies: {
      getAll: () => store.getAll(),
      setAll: (values) => values.forEach(({ name, value, options }) => store.set(name, value, options)),
    },
  });
}
