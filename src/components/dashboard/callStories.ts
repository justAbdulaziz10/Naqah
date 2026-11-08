import type { CallKind, CallLog, FarmReport, Workspace } from "@/domain/types";

export type CallGroup = "reports" | "followUps" | "yours";

const GROUP: Record<CallKind, CallGroup> = {
  worker_report: "reports",
  worker_report_missed: "reports",
  worker_report_rejected: "reports",
  owner_notification: "reports",
  worker_instruction: "followUps",
  worker_task_verification: "followUps",
  worker_callback: "followUps",
  owner_inquiry: "yours",
  owner_inquiry_rejected: "yours",
};

/** One report as it travelled: the worker's call, NAQAH's call to the owner, and any instruction passed back. */
export interface ReportStory {
  type: "report";
  id: string;
  at: string;
  group: "reports";
  call: CallLog;
  report: FarmReport | null;
  briefings: CallLog[];
  /** Each instruction call to the worker that followed this report's briefing, with its retries. */
  deliveries: CallLog[][];
}

/** A call, or one call and its retries (attempt 1, 2, 3…), shown as one line. */
export interface CallChain {
  type: "chain";
  id: string;
  at: string;
  group: CallGroup;
  calls: CallLog[];
}

export type CallEntry = ReportStory | CallChain;

const time = (iso: string) => Date.parse(iso);

/**
 * Groups the call log for reading, newest first. Retries join the call they repeat (same kind and
 * task, attempt numbers in sequence). A worker report gathers its owner briefing (by report id) and
 * the instruction calls placed after that briefing and before the next report. Display only: no
 * record is changed, and anything that doesn't fit stays its own line.
 */
export function callEntries(ws: Workspace): CallEntry[] {
  const calls = [...ws.calls].sort((a, b) => time(a.at) - time(b.at));
  const chains: CallLog[][] = [];
  for (const call of calls) {
    const chain = call.attempt && call.attempt > 1
      ? [...chains].reverse().find((candidate) => {
          const last = candidate[candidate.length - 1];
          return last.kind === call.kind && last.ticketId === call.ticketId && last.attempt === (call.attempt ?? 0) - 1;
        })
      : undefined;
    if (chain) chain.push(call);
    else chains.push([call]);
  }

  const stories: ReportStory[] = chains
    .filter((chain) => chain[0].kind === "worker_report")
    .map((chain) => ({
      type: "report",
      id: chain[0].id,
      at: chain[0].at,
      group: "reports",
      call: chain[0],
      report: ws.reports.find((report) => report.id === chain[0].reportId || report.callId === chain[0].id) ?? null,
      briefings: [],
      deliveries: [],
    }));
  const used = new Set<CallLog[]>(chains.filter((chain) => chain[0].kind === "worker_report"));

  for (const story of stories) {
    const reportId = story.report?.id ?? story.call.reportId;
    for (const chain of chains) {
      if (!used.has(chain) && chain[0].kind === "owner_notification" && reportId && chain[0].reportId === reportId) {
        story.briefings.push(...chain);
        used.add(chain);
      }
    }
  }
  stories.forEach((story, index) => {
    const briefing = story.briefings[0];
    if (!briefing) return;
    const until = stories[index + 1] ? time(stories[index + 1].at) : Infinity;
    for (const chain of chains) {
      const at = time(chain[0].at);
      if (!used.has(chain) && chain[0].kind === "worker_instruction" && at >= time(briefing.at) && at < until) {
        story.deliveries.push(chain);
        used.add(chain);
      }
    }
  });

  const rest: CallChain[] = chains
    .filter((chain) => !used.has(chain))
    .map((chain) => ({ type: "chain", id: chain[0].id, at: chain[chain.length - 1].at, group: GROUP[chain[0].kind], calls: chain }));

  return [...stories, ...rest].sort((a, b) => time(b.at) - time(a.at));
}
