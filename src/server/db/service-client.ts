import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/lib/supabase/config";

/**
 * Bypasses RLS, so only the voice service and schedulers may use it, after they have identified
 * the farm themselves. Never reachable from a browser or from an owner's request.
 */
export function createServiceClient(): SupabaseClient | null {
  const config = getSupabaseConfig();
  // SUPABASE_SERVICE_ROLE_KEY is the legacy name for the same server-only key.
  const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!config || !key || key.startsWith("sb_publishable_")) return null;
  return createClient(config.url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
