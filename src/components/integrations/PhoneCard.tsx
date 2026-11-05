"use client";

import { useEffect, useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui";
import { useI18n } from "@/i18n/client";

interface IntegrationStatus {
  ok: true;
  voice: { configured: boolean; number: string | null };
  whatsapp: { configured: boolean };
  ownerCall: { configured: boolean };
}

function disconnectedStatus(): IntegrationStatus {
  return {
    ok: true,
    voice: { configured: false, number: null },
    whatsapp: { configured: false },
    ownerCall: { configured: false },
  };
}

/** Settings → Connections → phone. */
export function PhoneCard() {
  const { m } = useI18n();
  const [status, setStatus] = useState<IntegrationStatus | null>(null);

  useEffect(() => {
    let active = true;
    if (typeof window === "undefined" || typeof window.fetch !== "function") {
      return;
    }
    window.fetch("/api/integrations/status", { headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error("status unavailable");
        const value = (await response.json()) as Partial<IntegrationStatus>;
        if (
          value.ok !== true ||
          !value.voice ||
          !value.whatsapp ||
          !value.ownerCall ||
          typeof value.voice.configured !== "boolean" ||
          typeof value.whatsapp.configured !== "boolean" ||
          typeof value.ownerCall.configured !== "boolean"
        ) {
          throw new Error("invalid integration status");
        }
        if (active) {
          setStatus({
            ok: true,
            voice: {
              configured: value.voice.configured,
              number: typeof value.voice.number === "string" ? value.voice.number : null,
            },
            whatsapp: value.whatsapp,
            ownerCall: value.ownerCall,
          });
        }
      })
      .catch(() => {
        if (active) setStatus(disconnectedStatus());
      });
    return () => {
      active = false;
    };
  }, []);

  const lineNumber = status?.voice.number;
  const dialNumber = lineNumber?.replace(/[^+\d]/g, "");
  return (
    <Card>
      <CardHeader title={m.integrations.phone.title} />
      <CardBody className="space-y-4">
        {!status ? <p className="text-sm text-muted">{m.integrations.phone.checking}</p> : null}
        {status && !status.voice.configured ? (
          <p className="text-sm text-muted">{m.integrations.phone.notConnected}</p>
        ) : null}
        {status?.voice.configured && lineNumber && dialNumber ? (
          <a
            href={`tel:${dialNumber}`}
            className="inline-flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold text-brown underline decoration-1 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          >
            <span>{m.integrations.phone.callNow}</span>
            <bdi className="ltr-nums">{lineNumber}</bdi>
          </a>
        ) : null}
        {status?.voice.configured && !lineNumber ? (
          <p className="text-sm text-muted">{m.integrations.phone.numberMissing}</p>
        ) : null}
        {status ? (
          <div className="space-y-1.5 border-t border-stone/60 pt-3 text-sm text-muted">
            <p>
              {m.integrations.phone.whatsapp}: {status.whatsapp.configured ? m.integrations.phone.connected : m.integrations.phone.notConnectedShort}
            </p>
            <p>
              {m.integrations.phone.ownerCall}: {status.ownerCall.configured ? m.integrations.phone.connected : m.integrations.phone.notConnectedShort}
            </p>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
