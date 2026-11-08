import "server-only";
import { getSupabaseConfig } from "./config";

export interface AuthMethodsAvailable {
  phone: boolean;
  email: boolean;
  google: boolean;
}

const TTL_MS = 5 * 60_000;
const TIMEOUT_MS = 2_500;
/** If Auth can't be asked, offer email only: it needs no SMS provider and never strands the owner. */
const FALLBACK: AuthMethodsAvailable = { phone: false, email: true, google: false };

let cached: { at: number; value: AuthMethodsAvailable } | null = null;

/**
 * Which sign-in methods this Supabase project actually has switched on (its public Auth settings).
 * A method the project doesn't allow is never offered, so a disabled SMS provider can't block sign-in.
 */
export async function getAuthMethods(now = Date.now()): Promise<AuthMethodsAvailable> {
  if (cached && now - cached.at < TTL_MS) return cached.value;
  const config = getSupabaseConfig();
  if (!config) return FALLBACK;
  try {
    const response = await fetch(`${config.url}/auth/v1/settings`, {
      headers: { apikey: config.key },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return FALLBACK;
    const external = ((await response.json()) as { external?: Record<string, unknown> }).external ?? {};
    const value = { phone: external.phone === true, email: external.email === true, google: external.google === true };
    // Never offer nothing: email is the documented default for owners.
    const usable = value.phone || value.email || value.google ? value : FALLBACK;
    cached = { at: now, value: usable };
    return usable;
  } catch {
    return FALLBACK;
  }
}

/** Tests only. */
export function resetAuthMethodsCache() {
  cached = null;
}
