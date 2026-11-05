import type { Camel, FarmReport, Finding, Relay, TaskTicket, Workspace } from "@/domain/types";

export type MatterInstruction =
  | { kind: "task"; id: string; text: string; at: string; ticket: TaskTicket }
  | { kind: "relay"; id: string; text: string; at: string };

/** One thing the owner is following: what was reported, and what was asked of the worker. */
export interface EstateMatter {
  id: string;
  camel: Camel | null;
  findings: Finding[];
  instructions: MatterInstruction[];
}

const words = (text: string) => ` ${text.replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLocaleLowerCase()} `;

/** Whole-word match, so a camel named ريم is not found inside كريم. */
export function mentions(text: string, name: string) {
  const needle = name.trim();
  return Boolean(needle) && words(text).includes(words(needle));
}

/** Whether a finding is about the herd, so a row with no named camel can still lead there. */
export function isHerdFinding(ws: Workspace, finding: Finding) {
  const kind = ws.settings.criteria.find((criterion) => criterion.id === finding.criterionId)?.kind;
  return kind === "sick_camel" || kind === "missing_camel";
}

const concern = { sick: 0, watch: 1 } as const;

/**
 * Groups the latest report with the instructions that followed it. Records hold no link between a
 * finding, a camel and a task, so they are grouped by the camel's name for display only. Anything
 * unnamed stays its own row, and no rule depends on this grouping.
 */
export function estateMatters(ws: Workspace, report: FarmReport | null): EstateMatter[] {
  const tasks: MatterInstruction[] = ws.settings.plan === "ultimate"
    ? ws.taskTickets.filter((t) => t.status === "open").map((ticket) => ({ kind: "task", id: ticket.id, text: ticket.instruction, at: ticket.createdAt, ticket }))
    : [];
  const relays: MatterInstruction[] = ws.relays
    .filter((relay: Relay) => !relay.delivered)
    .map((relay) => ({ kind: "relay", id: relay.id, text: relay.message, at: relay.at }));
  const instructions = [...tasks, ...relays];
  const findings = report?.findings ?? [];
  const used = new Set<string>();

  const named = ws.camels
    .map((camel) => {
      const about = (text: string) => mentions(text, camel.name);
      return {
        id: camel.id,
        camel,
        findings: findings.filter((f) => !used.has(f.id) && (about(f.text.ar) || about(f.text.en))),
        instructions: instructions.filter((i) => !used.has(i.id) && about(i.text)),
      };
    })
    .filter((matter) => matter.camel.health === "sick" || matter.camel.health === "watch" || matter.findings.length > 0 || matter.instructions.length > 0)
    .map((matter) => {
      [...matter.findings, ...matter.instructions].forEach((item) => used.add(item.id));
      return matter;
    })
    .sort((a, b) => (concern[a.camel.health as keyof typeof concern] ?? 2) - (concern[b.camel.health as keyof typeof concern] ?? 2));

  return [
    ...named,
    ...findings.filter((f) => !used.has(f.id)).map((f) => ({ id: f.id, camel: null, findings: [f], instructions: [] })),
    ...instructions.filter((i) => !used.has(i.id)).map((i) => ({ id: i.id, camel: null, findings: [], instructions: [i] })),
  ];
}
