/**
 * The official camel count belongs to the owner. A worker's count on a report call is a proposal:
 * it shows on the dashboard until the owner accepts or dismisses it, and never overwrites silently.
 */
import type { FarmReport, Workspace } from "./types";

export const MAX_HERD_COUNT = 100_000;

export function isHerdCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_HERD_COUNT;
}

export interface HerdCountProposal {
  reportId: string;
  at: string;
  reported: number;
  official: number | null;
}

/** The latest report's count when it differs from the official one and the owner hasn't reviewed it. */
export function herdCountProposal(ws: Workspace): HerdCountProposal | null {
  const report: FarmReport | undefined = ws.reports[ws.reports.length - 1];
  if (!report || !isHerdCount(report.herdCountReported)) return null;
  const official = ws.settings.herdCount ?? null;
  if (report.herdCountReported === official) return null;
  const reviewed = ws.settings.herdCountReviewedAt;
  if (reviewed && new Date(report.at).getTime() <= new Date(reviewed).getTime()) return null;
  return { reportId: report.id, at: report.at, reported: report.herdCountReported, official };
}

/** Owner accepts the worker's count as the new official count. */
export function acceptHerdCountProposal(ws: Workspace, now: Date): Workspace {
  const proposal = herdCountProposal(ws);
  if (!proposal) return ws;
  return {
    ...ws,
    settings: { ...ws.settings, herdCount: proposal.reported, herdCountReviewedAt: now.toISOString() },
  };
}

/** Owner keeps the official count; the proposal disappears. */
export function dismissHerdCountProposal(ws: Workspace, now: Date): Workspace {
  if (!herdCountProposal(ws)) return ws;
  return { ...ws, settings: { ...ws.settings, herdCountReviewedAt: now.toISOString() } };
}
