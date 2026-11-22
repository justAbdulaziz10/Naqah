import type { SupabaseClient, User } from "@supabase/supabase-js";
import { withTimeout } from "@/lib/supabase/timeout";
import { DbError } from "@/server/db/errors";
import { isUuid } from "@/server/db/ids";
import { parseCallAllowlist } from "./calls/config";

type Phase = "report" | "owner" | "worker";
type TestCallScope = { kind: "off" } | { kind: "invalid" } | {
  kind: "ranch";
  farmId: string;
  ownerEmail: string;
  allowlist: string[];
  phase: Phase | undefined;
  maxCalls: number;
};

type OwnerScope = { kind: "off" } | { kind: "invalid"; setting: string }
  | { kind: "setup"; email: string } | { kind: "ranch"; email: string; farmId: string };
type OwnerIdentity = Pick<User, "id" | "email" | "email_confirmed_at">;

export function testOwnerScope(): OwnerScope {
  const rawEmail = process.env.NAQAH_TEST_OWNER_EMAIL;
  const farmId = process.env.NAQAH_TEST_RANCH_ID;
  if (rawEmail === undefined && farmId === undefined && !process.env.NAQAH_TEST_CALL_PHASE && !process.env.NAQAH_TEST_MAX_CALLS) {
    return { kind: "off" };
  }
  const email = rawEmail?.trim().toLowerCase();
  if (!email) return { kind: "invalid", setting: "NAQAH_TEST_OWNER_EMAIL" };
  if (farmId === undefined) return { kind: "setup", email };
  if (!farmId || !isUuid(farmId) || farmId !== farmId.toLowerCase()) {
    return { kind: "invalid", setting: "NAQAH_TEST_RANCH_ID" };
  }
  return { kind: "ranch", email, farmId };
}

function confirmedEmailMatches(user: OwnerIdentity, email: string): boolean {
  return Boolean(user.email_confirmed_at && user.email?.toLowerCase() === email);
}

/** Auth must supply the identity. Verify it before reading even the ranch's ownership metadata. */
export async function testOwnerCanAccess(client: SupabaseClient, user: OwnerIdentity): Promise<boolean> {
  const scope = testOwnerScope();
  if (scope.kind === "off") return true;
  if (scope.kind === "invalid" || !confirmedEmailMatches(user, scope.email)) return false;
  if (scope.kind === "setup") return true;
  const { data, error } = await client.from("farms").select("id").eq("id", scope.farmId).eq("owner_id", user.id).maybeSingle();
  return !error && data?.id === scope.farmId;
}

// Each refusal reason is logged once per instance, so a misconfigured preview doesn't flood its logs.
const loggedRefusals = new Set<string>();

/** A preview with incomplete test settings must never fall back to calling every ranch. */
export function testCallScope(): TestCallScope {
  const owner = testOwnerScope();
  const invalid = (setting: string): TestCallScope => {
    if (!loggedRefusals.has(setting)) {
      loggedRefusals.add(setting);
      console.error(`[NAQAH] test-ranch calling refused: invalid or missing ${setting}`);
    }
    return { kind: "invalid" };
  };
  if (owner.kind === "off") {
    return process.env.VERCEL_ENV === "preview" && process.env.NAQAH_PREVIEW_ALL_RANCHES !== "1"
      ? invalid("NAQAH_TEST_RANCH_ID") : { kind: "off" };
  }
  if (owner.kind === "invalid") return invalid(owner.setting);
  if (owner.kind === "setup") return invalid("NAQAH_TEST_RANCH_ID");
  const { farmId } = owner;
  const phase = process.env.NAQAH_TEST_CALL_PHASE || undefined;
  const maxCalls = process.env.NAQAH_TEST_MAX_CALLS;
  const allowlist = parseCallAllowlist(process.env.NAQAH_CALL_ALLOWLIST ?? "");
  if (!allowlist.length) return invalid("NAQAH_CALL_ALLOWLIST");
  if (!process.env.NAQAH_VOICE_SECRET?.trim()) return invalid("NAQAH_VOICE_SECRET");
  if (phase !== undefined && phase !== "report" && phase !== "owner" && phase !== "worker") return invalid("NAQAH_TEST_CALL_PHASE");
  if (maxCalls && !/^(?:[1-9]|1[0-2])$/.test(maxCalls)) return invalid("NAQAH_TEST_MAX_CALLS");
  return { kind: "ranch", farmId, ownerEmail: owner.email, allowlist, phase, maxCalls: maxCalls ? Number(maxCalls) : 8 };
}

export function callingFarmAllowed(farmId: string): boolean {
  const scope = testCallScope();
  return scope.kind === "off" || (scope.kind === "ranch" && scope.farmId === farmId);
}

export function requireCallingFarm(farmId: string): void {
  if (!callingFarmAllowed(farmId)) throw new DbError("unavailable");
}

// A confirmed match is remembered briefly, so one call's many webhook steps don't each repeat two network
// lookups (and fail mid-call on an Auth hiccup). Only successes are kept; a refusal is always rechecked.
const OWNER_CHECK_TTL_MS = 60_000;
let verifiedOwner: { farmId: string; email: string; until: number } | null = null;

/** Service entry points have no owner session. Check only the configured ranch and its Auth owner. */
export async function verifyCallingOwner(client: SupabaseClient, farmId?: string): Promise<boolean> {
  const scope = testCallScope();
  if (scope.kind === "off") return true;
  if (scope.kind !== "ranch" || (farmId !== undefined && farmId !== scope.farmId)) return false;
  if (verifiedOwner?.farmId === scope.farmId && verifiedOwner.email === scope.ownerEmail && verifiedOwner.until > Date.now()) return true;
  try {
    const ok = await withTimeout((async () => {
      const { data: farm, error } = await client.from("farms").select("owner_id").eq("id", scope.farmId).maybeSingle();
      if (error || !farm?.owner_id) return false;
      const { data, error: authError } = await client.auth.admin.getUserById(farm.owner_id);
      return !authError && data.user?.id === farm.owner_id && confirmedEmailMatches(data.user, scope.ownerEmail);
    })(), 3_000);
    verifiedOwner = ok ? { farmId: scope.farmId, email: scope.ownerEmail, until: Date.now() + OWNER_CHECK_TTL_MS } : null;
    return ok;
  } catch {
    return false;
  }
}

/** Tests only: forget a remembered owner check and which refusals were already logged. */
export function resetCallingOwnerCheck(): void {
  verifiedOwner = null;
  loggedRefusals.clear();
}

// loadFarm is also used by the owner repository under RLS. Mark service clients at creation
// so even a direct call to the shared query cannot bypass the ranch guard.
const serviceClients = new WeakSet<SupabaseClient>();

export function markServiceClient(client: SupabaseClient): SupabaseClient {
  serviceClients.add(client);
  return client;
}

export function isServiceClient(client: SupabaseClient): boolean {
  return serviceClients.has(client);
}
