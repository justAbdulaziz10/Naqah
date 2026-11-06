"use client";

import type { ResourceKind } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { isSampleWorkerPhone, supplierOrderText, waLink, workerMessageText } from "@/lib/whatsapp/links";
import { useWorkspace } from "@/store/workspace";

const linkClass =
  "inline-flex min-h-11 items-center text-brown underline decoration-stone underline-offset-4 hover:decoration-brown focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown";

export function MessageWorkerLink() {
  const ws = useWorkspace();
  const { locale, m } = useI18n();
  if (!ws) return null;

  if (isSampleWorkerPhone(ws.settings.worker.phone)) return null;
  const href = waLink(ws.settings.worker.phone, workerMessageText(ws, locale));
  if (!href) return null;

  return (
    <a className={linkClass} href={href} target="_blank" rel="noopener noreferrer">
      {m.integrations.whatsapp.messageWorker}
    </a>
  );
}

export function OrderSupplierLink({ kinds }: { kinds: readonly ResourceKind[] }) {
  const ws = useWorkspace();
  const { locale, m } = useI18n();
  if (!ws) return null;

  const text = supplierOrderText(ws, locale, kinds);
  const href = text && ws.settings.integrations?.supplierPhone
    ? waLink(ws.settings.integrations.supplierPhone, text)
    : null;
  if (!href) return null;

  return (
    <a className={linkClass} href={href} target="_blank" rel="noopener noreferrer">
      {m.integrations.whatsapp.orderSupplier}
    </a>
  );
}
