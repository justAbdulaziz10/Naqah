import type { Finding, Workspace } from "@/domain/types";

const HERD_CRITERIA = new Set(["sick_camel", "missing_camel"]);

/** Where a finding about the herd leads: the camel it names, the herd when it names none, or nowhere for other findings. */
export function findingHerdTarget(ws: Workspace, finding: Finding): { camelId: string | null } | null {
  const kind = ws.settings.criteria.find((criterion) => criterion.id === finding.criterionId)?.kind;
  if (!kind || !HERD_CRITERIA.has(kind)) return null;
  // Findings keep plain text, not a camel id. The longest match keeps "Wadha" from claiming "Wadha 2".
  const named = ws.camels
    .filter((camel) => camel.name.trim() && (finding.text.en.includes(camel.name) || finding.text.ar.includes(camel.name)))
    .sort((a, b) => b.name.length - a.name.length)[0];
  return { camelId: named?.id ?? null };
}
