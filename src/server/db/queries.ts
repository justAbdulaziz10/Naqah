import type { SupabaseClient } from "@supabase/supabase-js";
import type { Workspace } from "@/domain/types";
import { DbError, fromPostgrest } from "./errors";
import { workspaceFromRows } from "./mappers";
import type { FarmRow, FarmRows } from "./rows";

/** Enough history for every rule, which looks at the current week, open items and recent activity. */
const RECENT = 200;
const PAGE = 500;

export interface LoadedFarm {
  farmId: string;
  revision: number;
  workspace: Workspace;
}

function rows<T>(result: { data: unknown; error: { code?: string; message?: string } | null }): T[] {
  if (result.error) throw fromPostgrest(result.error);
  return (result.data ?? []) as T[];
}

/** PostgREST caps a response, so lists without a natural limit are read page by page. */
export async function allPages<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const batch = rows<T>(await page(from, from + PAGE - 1));
    all.push(...batch);
    if (batch.length < PAGE) return all;
  }
}

const merge = <T extends { id: string }>(...lists: T[][]) => [...new Map(lists.flat().map((row) => [row.id, row])).values()];

/** Works for both clients: under RLS with an owner session, or with the service key. */
export async function loadFarmRows(client: SupabaseClient, farm: FarmRow): Promise<FarmRows> {
  const from = (table: string, columns = "*") => client.from(table).select(columns).eq("farm_id", farm.id);
  const [
    workers, camels, resources, customQuestions, criteria, emergencies, reports, calls, openTasks, recentTasks,
    openNoAnswer, recentNoAnswer, pendingCalls, recentCalls, activeRuns, recentRuns, relays, events,
  ] = await Promise.all([
    from("workers").order("created_at").order("id"),
    allPages<FarmRows["camels"][number]>((start, end) => from("camels").order("created_at").order("id").range(start, end)),
    from("resources"),
    allPages<FarmRows["customQuestions"][number]>((start, end) => from("custom_questions").order("sort_order").order("created_at").order("id").range(start, end)),
    from("criteria"),
    from("emergency_categories"),
    from("reports", "*, report_answers(*), findings(*)").order("at", { ascending: false }).limit(RECENT),
    from("calls").order("at", { ascending: false }).limit(RECENT),
    from("task_tickets").eq("status", "open"),
    from("task_tickets").order("created_at", { ascending: false }).limit(RECENT),
    from("no_answer_tickets").eq("status", "open"),
    from("no_answer_tickets").order("created_at", { ascending: false }).limit(RECENT),
    from("pending_worker_calls", "*, worker_call_attempts(*), pending_worker_call_tasks(*)").in("state", ["pending", "no_answer_ticket"]),
    from("pending_worker_calls", "*, worker_call_attempts(*), pending_worker_call_tasks(*)").order("created_at", { ascending: false }).limit(RECENT),
    from("report_call_runs").in("state", ["calling", "answered"]),
    from("report_call_runs").order("occurrence", { ascending: false }).limit(RECENT),
    from("relays").order("at", { ascending: false }).limit(RECENT),
    from("events").order("at", { ascending: false }).limit(RECENT),
  ]);
  return {
    farm,
    workers: rows(workers),
    camels,
    resources: rows(resources),
    customQuestions,
    criteria: rows(criteria),
    emergencies: rows(emergencies),
    reports: rows(reports),
    calls: rows(calls),
    taskTickets: merge(rows<FarmRows["taskTickets"][number]>(openTasks), rows(recentTasks)),
    noAnswerTickets: merge(rows<FarmRows["noAnswerTickets"][number]>(openNoAnswer), rows(recentNoAnswer)),
    pendingWorkerCalls: merge(rows<FarmRows["pendingWorkerCalls"][number]>(pendingCalls), rows(recentCalls)),
    reportCallRuns: merge(rows<FarmRows["reportCallRuns"][number]>(activeRuns), rows(recentRuns)),
    relays: rows(relays),
    events: rows(events),
  };
}

export async function loadFarm(client: SupabaseClient, match: { id: string } | { owner_id: string }): Promise<LoadedFarm | null> {
  const [column, value] = Object.entries(match)[0];
  const { data, error } = await client.from("farms").select("*").eq(column, value).maybeSingle();
  if (error) throw fromPostgrest(error);
  if (!data) return null;
  const farm = data as FarmRow;
  return { farmId: farm.id, revision: farm.revision, workspace: workspaceFromRows(await loadFarmRows(client, farm)) };
}

export function requireFarm(loaded: LoadedFarm | null): LoadedFarm {
  if (!loaded) throw new DbError("not_found");
  return loaded;
}
