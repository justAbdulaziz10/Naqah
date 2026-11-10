import "server-only";
import { normalizeSaudiPhone } from "@/lib/supabase/auth-input";

export const testCallsEnabled = () => process.env.NAQAH_TEST_CALLS === "1";

export function isTestCallAdmin(user: { id: string; email?: string | null; email_confirmed_at?: string | null }): boolean {
  const allowed = (process.env.NAQAH_TEST_CALL_ADMINS ?? "").split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(user.id.toLowerCase()) || Boolean(user.email && user.email_confirmed_at && allowed.includes(user.email.toLowerCase()));
}

export function testCallPhone(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 80 || !/^[+\d\s-]+$/.test(value)) return null;
  const compact = value.replace(/[\s-]/g, "");
  if (!/^(?:\+9665\d{8}|9665\d{8}|05\d{8}|5\d{8})$/.test(compact)) return null;
  return normalizeSaudiPhone(compact);
}
