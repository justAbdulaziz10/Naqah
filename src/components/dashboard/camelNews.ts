import type { Camel, FarmReport, LocalizedText, TaskTicket, Workspace } from "@/domain/types";

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether a text names this camel, as a whole word. Arabic joins "and", "so", "with" and "to" to the next
 * word («ووضحة», «لمزون»), so one of those letters may lead the name.
 */
export function namesCamel(text: string, name: string): boolean {
  const needle = name.trim();
  if (!needle) return false;
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:[وفبل])?${escape(needle)}(?=$|[^\\p{L}\\p{N}])`, "u").test(text);
}

/**
 * The part of a sentence about this camel: «كلهم بخير، ووضحة رجعت تاكل» → «وضحة رجعت تاكل». Splits on
 * commas, stops and «بس» / "but"; a leading joined «و» is dropped. null when the camel is not named.
 */
export function clauseAbout(text: string, name: string): string | null {
  const parts = text.split(/[،,؛;.\n]|\s+(?:بس|لكن|but)\s+/u).map((part) => part.trim());
  const index = parts.findIndex((part) => namesCamel(part, name));
  if (index < 0) return null;
  const clause = parts[index];
  // A clause after the first usually opens with the joined «و» ("and"); a name that itself starts with و stays whole.
  const joined = clause.startsWith(`و${name.trim()}`) || (index > 0 && clause.startsWith("و") && !clause.startsWith(name.trim()));
  return joined ? clause.slice(1) : clause;
}

export interface CamelNews {
  at: string;
  reportId: string;
  /** A finding is localized; the worker's own words are not. */
  text: LocalizedText | string;
  source: "finding" | "words";
}

/** What one report says about the camel: its finding if there is one, otherwise the worker's words. */
export function reportNews(report: FarmReport, camel: Camel): CamelNews | null {
  const finding = report.findings.find((item) => namesCamel(item.text.ar, camel.name) || namesCamel(item.text.en, camel.name));
  if (finding) return { at: report.at, reportId: report.id, text: finding.text, source: "finding" };
  for (const answer of report.answers) {
    const clause = clauseAbout(answer.answer, camel.name);
    if (clause) return { at: report.at, reportId: report.id, text: clause, source: "words" };
  }
  return null;
}

/** Every report that names the camel, newest first. Display only: records hold no link to a camel. */
export function camelNews(ws: Workspace, camel: Camel): CamelNews[] {
  return [...ws.reports]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .map((report) => reportNews(report, camel))
    .filter((news): news is CamelNews => news !== null);
}

/** The owner's open tasks that name the camel (Ultimate only), newest first. */
export function openTasksFor(ws: Workspace, camel: Camel): TaskTicket[] {
  if (ws.settings.plan !== "ultimate") return [];
  return ws.taskTickets
    .filter((ticket) => ticket.status === "open" && namesCamel(ticket.instruction, camel.name))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
