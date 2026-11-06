import { safeReturnPath } from './auth-input';

export const AUTH_RETURN_COOKIE = 'naqah-auth-return';

/** A short-lived navigation hint, never identity/session proof. Validate it again on the server. */
export function readAuthReturn(value: string | undefined) {
  if (!value || value.length > 6144) return null;
  try { return safeReturnPath(decodeURIComponent(value)); }
  catch { return null; }
}

export function rememberAuthReturn(destination: unknown) {
  const next = safeReturnPath(destination);
  try {
    document.cookie = `${AUTH_RETURN_COOKIE}=${next ? encodeURIComponent(next) : ''}; Path=/; Max-Age=${next ? 3600 : 0}; SameSite=Lax${window.location.protocol === 'https:' ? '; Secure' : ''}`;
  } catch { /* The explicit callback next still works when a navigation-hint cookie is blocked. */ }
}
