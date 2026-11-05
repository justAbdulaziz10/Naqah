import { levelLabel, RESOURCE_LABELS } from "@/domain/catalog";
import type { Locale, ResourceKind, Workspace } from "@/domain/types";
import { whatsapp } from "@/i18n/messages/integrations/whatsapp";

/** Normalize supported Saudi mobile formats to the digits-only wa.me form. */
export function toWaDigits(phone: string): string | null {
  const normalized = phone.replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
  const withPersianDigits = normalized.replace(/[۰-۹]/g, (digit) =>
    String(digit.charCodeAt(0) - 0x06f0),
  );
  const compact = withPersianDigits.replace(/[\s().-]/g, "");
  const digits = compact.startsWith("+") ? compact.slice(1) : compact;
  if (!/^\d+$/.test(digits)) return null;

  if (/^05\d{8}$/.test(digits)) return "966" + digits.slice(1);
  if (/^9665\d{8}$/.test(digits)) return digits;
  return null;
}

export function waLink(phone: string, text: string): string | null {
  const digits = toWaDigits(phone);
  if (!digits) return null;
  return "https://wa.me/" + digits + "?text=" + encodeURIComponent(text);
}

export function supplierOrderText(
  ws: Workspace,
  locale: Locale,
  resourceKinds: readonly ResourceKind[],
): string | null {
  const resources = ws.resources.filter(
    (resource) =>
      resource.present &&
      resourceKinds.includes(resource.kind) &&
      (resource.level === "low" || resource.level === "critical"),
  );
  if (resources.length === 0) return null;

  const messages = whatsapp[locale];
  const supplierName = ws.settings.integrations?.supplierName?.trim() ?? "";
  const lines = resources.map((resource) =>
    messages.supplierOrderLine(
      RESOURCE_LABELS[resource.kind][locale],
      resource.quantity?.trim() || messages.quantityNotRecorded,
      levelLabel(resource.kind, resource.level)[locale],
    ),
  );
  return [messages.supplierOrderIntro(supplierName, ws.settings.farm.name), ...lines].join("\n");
}

export function workerMessageText(ws: Workspace, locale: Locale): string {
  return whatsapp[locale].workerMessage(ws.settings.worker.name);
}
