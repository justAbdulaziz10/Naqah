import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseConfig, sessionCookieOptionsFor } from './config';
import { withTimeout } from './timeout';

// Only signed-in visitors reach the network here; an outage must not hold every page.
const SESSION_REFRESH_TIMEOUT_MS = 2_000;

/** Refresh cookies only; existing demo routes remain public. */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const config = getSupabaseConfig();
  if (!config) return response;
  const client = createServerClient(config.url, config.key, {
    cookieOptions: sessionCookieOptionsFor(request.nextUrl),
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values, headers) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
      },
    },
  });
  try { await withTimeout(client.auth.getClaims(), SESSION_REFRESH_TIMEOUT_MS); }
  catch { /* Auth-server outages must not break the public demo. Protected data revalidates separately. */ }
  return response;
}
