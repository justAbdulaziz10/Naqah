/**
 * Important findings (owner-configured criteria) and the owner briefing the AI
 * speaks after a successful update (Phase 4).
 */
import { CRITERION_LABELS, RESOURCE_LABELS, levelLabel } from "./catalog";
import { uid } from "./id";
import type { Camel, Finding, LocalizedText, ReportAnswer, Resource, ResourceKind, Workspace } from "./types";

export interface ReportDraft {
  answers: ReportAnswer[];
  camelUpdates: { camelId: string; health: Camel["health"]; note: string | null; certainty: Camel["certainty"] }[];
  resourceUpdates: {
    kind: ResourceKind;
    level: Resource["level"];
    quantity: string | null;
    note: string | null;
    certainty: Resource["certainty"];
  }[];
  /** Answer to "are all camels accounted for?" — null when unknown / not asked. */
  herdAccountedFor: boolean | null;
  /** Ultimate: answers about open task tickets asked during this interaction. */
  taskConfirmations: { taskId: string; done: boolean }[];
}

const LOW = new Set(["low", "critical"]);

/** Evaluate a report draft against the owner's enabled criteria. */
export function evaluateFindings(ws: Workspace, draft: ReportDraft): Finding[] {
  const out: Finding[] = [];
  const camel = (id: string) => ws.camels.find((c) => c.id === id);
  const res = (kind: ResourceKind) => draft.resourceUpdates.find((r) => r.kind === kind);

  for (const c of ws.settings.criteria) {
    if (!c.enabled) continue;
    const push = (text: LocalizedText) => out.push({ id: uid("fnd"), criterionId: c.id, text });

    switch (c.kind) {
      case "sick_camel":
        for (const u of draft.camelUpdates) {
          if (u.health !== "sick" && u.health !== "watch") continue;
          const name = camel(u.camelId)?.name ?? "?";
          const note = u.note ? ` — ${u.note}` : "";
          push(
            u.health === "sick"
              ? { ar: `${name} مريضة بحسب إفادة العامل${note}`, en: `${name} is sick, as reported by the worker${note}` }
              : { ar: `${name} تحت الملاحظة${note}`, en: `${name} is under watch${note}` },
          );
        }
        break;
      case "missing_camel":
        if (draft.herdAccountedFor === false)
          push({ ar: "العامل أفاد أن الحلال غير مكتمل العدد", en: "The worker reported that not all camels are accounted for" });
        break;
      case "low_feed":
      case "low_water":
      case "medicine_low":
      case "fence_damage": {
        const kind: ResourceKind =
          c.kind === "low_feed" ? "feed" : c.kind === "low_water" ? "water" : c.kind === "medicine_low" ? "medicine" : "fences";
        const r = res(kind);
        if (r && LOW.has(r.level)) {
          const lvl = levelLabel(kind, r.level);
          const qty = r.quantity ? ` (${r.quantity})` : "";
          push({
            ar: `${RESOURCE_LABELS[kind].ar}: ${lvl.ar}${qty}`,
            en: `${RESOURCE_LABELS[kind].en}: ${lvl.en}${qty}`,
          });
        }
        break;
      }
      case "custom": {
        const words = (c.label ?? "").split(/[,،]/).map((w) => w.trim().toLowerCase()).filter(Boolean);
        if (!words.length) break;
        const hit = draft.answers.find((a) => words.some((w) => a.answer.toLowerCase().includes(w)));
        if (hit) push({ ar: `${c.label}: «${hit.answer}»`, en: `${c.label}: “${hit.answer}”` });
        break;
      }
    }
  }
  return out;
}

export function criterionLabel(c: Workspace["settings"]["criteria"][number]): LocalizedText {
  if (c.kind === "custom") return { ar: c.label ?? "", en: c.label ?? "" };
  return CRITERION_LABELS[c.kind];
}

/**
 * What the agent says when the owner answers the post-update call.
 * Leads with important findings only; otherwise confirms the update without
 * claiming the farm is definitely fine (identity spec §5).
 */
export function ownerBriefing(findings: Finding[]): LocalizedText {
  if (!findings.length) {
    return {
      ar: "وصل تحديث الحلال، وما فيه ملاحظات مهمة بحسب آخر تقرير من العامل. التفاصيل موجودة في الموقع.",
      en: "The farm update is in. Based on the worker's latest report, there is nothing important to flag. The details are on the website.",
    };
  }
  const ar = findings.map((f) => f.text.ar).join("، و");
  const en = findings.map((f) => f.text.en).join("; ");
  return {
    ar: `وصل تحديث الحلال. أهم ما فيه: ${ar}. التفاصيل موجودة في الموقع.`,
    en: `The farm update is in. What matters: ${en}. The details are on the website.`,
  };
}
