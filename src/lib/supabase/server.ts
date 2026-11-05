import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getSupabaseConfig } from './config';

export async function createClient() {
  const config = getSupabaseConfig();
  if (!config) return null;
  const store = await cookies();
  return createServerClient(config.url, config.key, {
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
  const client = await createClient();
  if (!client) return { user: null, unavailable: true };
  try {
    const { data, error } = await client.auth.getUser();
    return { user: error ? null : data.user, unavailable: !!error && error.status !== 401 && error.status !== 403 && error.name !== 'AuthSessionMissingError' };
  } catch { return { user: null, unavailable: true }; }
}

export async function createWritableClient() {
  const config = getSupabaseConfig();
  if (!config) return null;
  const store = await cookies();
  return createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (values) => values.forEach(({ name, value, options }) => store.set(name, value, options)),
    },
  });
}
