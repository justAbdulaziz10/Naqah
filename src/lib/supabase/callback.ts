import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isLocale } from '@/i18n/config';
import { getSupabaseConfig, sessionCookieOptionsFor } from './config';
import { withTimeout } from './timeout';
import { safeReturnPath } from './auth-input';
import { successPath } from './auth-paths';
import { AUTH_RETURN_COOKIE, readAuthReturn } from './return-context';

/** Complete a PKCE flow without rendering the code, provider errors, or tokens. */
export async function completeAuthCallback(request: NextRequest, locale: string) {
  if (!isLocale(locale)) return new NextResponse(null, { status: 404 });
  const params = request.nextUrl.searchParams;
  const next = params.has('next')
    ? params.getAll('next').length === 1 ? safeReturnPath(params.get('next')) : null
    : readAuthReturn(request.cookies.get(AUTH_RETURN_COOKIE)?.value);
  const failure = new URL(`/${locale}/login`, request.url);
  failure.searchParams.set('error', 'callbackFailed');
  if (params.get('method') === 'email') failure.searchParams.set('method', 'email');
  if (next) failure.searchParams.set('next', next);
  // Keep cookies/cache headers on this very response when changing its destination.
  // Relative Location keeps the browser's actual origin, even when Next.js runs
  // behind a proxy or uses a different internal hostname. Never trust forwarded hosts.
  const response = new NextResponse(null, { status: 303, headers: { Location: failure.pathname + failure.search } });
  const cookieOptions = sessionCookieOptionsFor(request.nextUrl);
  response.cookies.set(AUTH_RETURN_COOKIE, '', { ...cookieOptions, maxAge: 0 });
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  const config = getSupabaseConfig();
  const code = params.get('code');
  const flowId = params.get('sb_flow_id');
  if (!config || !code || params.getAll('code').length !== 1 || params.has('error') || params.has('error_code') || params.getAll('sb_flow_id').length > 1) return response;
  try {
    const client = createServerClient(config.url, config.key, {
      cookieOptions,
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(values, headers) {
          values.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
          Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
        },
      },
    });
    // Newer auth-js can keep a verifier for each flow; never borrow another flow's verifier.
    const { data, error } = await withTimeout(client.auth.exchangeCodeForSession(code, flowId !== null ? { flowId } : undefined), 10_000);
    if (!error && data.session) response.headers.set('Location', successPath(locale, next));
  } catch { /* Fixed translated error on login; do not expose provider details. */ }
  return response;
}
