import { answer, start, type AnswerInput, type CallSession, type Scenario } from "@/domain/conversation/engine";
import { placeReportCallAttempt, startReportCall } from "@/domain/reportCalls";
import { createDemoWorkspace } from "@/domain/seed";
import type { Locale, Workspace } from "@/domain/types";
import { isVoiceMiss, type VoiceState } from "./state";

export interface ReplayResult {
  workspace: Workspace;
  session: CallSession;
}

function idDefinitions(value: unknown, into: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) idDefinitions(item, into);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      if (key === "id" && typeof child === "string") into.push(child);
      idDefinitions(child, into);
    }
  }
  return into;
}

function stableIdMap(workspace: Workspace): Map<string, string> {
  const counts = new Map<string, number>();
  const mapping = new Map<string, string>();
  for (const id of idDefinitions(workspace)) {
    if (mapping.has(id)) continue;
    const prefix = id.split("_", 1)[0];
    const count = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, count);
    mapping.set(id, `${prefix}_demo${String(count).padStart(2, "0")}`);
  }
  return mapping;
}

function remapIds<T>(value: T, mapping: Map<string, string>): T {
  if (typeof value === "string") {
    let remapped: string = value;
    for (const [from, to] of mapping) remapped = remapped.replaceAll(from, to);
    return remapped as T;
  }
  if (Array.isArray(value)) return value.map((item) => remapIds(item, mapping)) as T;
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, remapIds(child, mapping)])) as T;
  }
  return value;
}

function stabilizeWorkspace(workspace: Workspace): { workspace: Workspace; ids: Map<string, string> } {
  const ids = stableIdMap(workspace);
  return { workspace: remapIds(workspace, ids), ids };
}

function stableDemoWorkspace(locale: Locale, now: Date): Workspace {
  const workspace = createDemoWorkspace(locale, "ultimate", now);
  workspace.createdAt = now.toISOString();
  return stabilizeWorkspace(workspace).workspace;
}

function applyResult(
  workspace: Workspace,
  session: CallSession,
  result: ReturnType<typeof start> | ReturnType<typeof answer>,
): { workspace: Workspace; session: CallSession } {
  if (!result.commit) return { workspace, session: result.session };
  const stabilized = stabilizeWorkspace(result.commit(workspace));
  return {
    workspace: stabilized.workspace,
    session: remapIds(result.session, stabilized.ids),
  };
}

/** The sample line plays NAQAH's report call as if the worker had just picked it up. */
function answeredSampleReportCall(workspace: Workspace, now: Date): { workspace: Workspace; reportCallId?: string } {
  const opened = startReportCall(workspace, now, "manual");
  if (!opened.run) return { workspace };
  const stable = stabilizeWorkspace(placeReportCallAttempt(opened.ws, now, opened.run.id).ws);
  return { workspace: stable.workspace, reportCallId: stable.ids.get(opened.run.id) };
}

export function newVoiceState(scenario: Scenario, locale: Locale, startedAt = Date.now(), callSid?: string): VoiceState {
  if (scenario !== "report_call" && scenario !== "owner_inquiry") {
    throw new Error("Unsupported inbound voice scenario");
  }
  return { v: 1, sc: scenario, l: locale, t: startedAt, ...(callSid === undefined ? {} : { callSid }), a: [] };
}

export function replayVoiceState(state: VoiceState): ReplayResult {
  const now = new Date(state.t);
  let workspace = stableDemoWorkspace(state.l, now);
  let reportCallId: string | undefined;
  if (state.sc === "report_call") ({ workspace, reportCallId } = answeredSampleReportCall(workspace, now));
  let result = start(workspace, now, state.sc, { reportCallId });
  let applied = applyResult(workspace, result.session, result);
  workspace = applied.workspace;
  let session = applied.session;

  for (const input of state.a) {
    if (isVoiceMiss(input)) continue;
    result = answer(session, workspace, now, input);
    applied = applyResult(workspace, session, result);
    workspace = applied.workspace;
    session = applied.session;
  }
  return { workspace, session };
}

export function voiceActionUrl(_requestUrl: string, signedState: string): string {
  return `/api/voice/turn?${new URLSearchParams({ s: signedState }).toString()}`;
}

export function trailingMissCount(inputs: AnswerInput[]): number {
  let count = 0;
  for (let index = inputs.length - 1; index >= 0 && isVoiceMiss(inputs[index]); index -= 1) count += 1;
  return count;
}
