"use client";

import { useEffect, useState } from "react";
import { SettingsDisclosure } from "@/components/setup/sections/SettingsDisclosure";
import { useI18n } from "@/i18n/client";
import { useIsAccount } from "@/store/workspace";

interface IntegrationStatus {
  ok: true;
  voice: { mode: "farm" | "sample"; configured: boolean; number: string | null; signatureValidation: boolean };
  whatsapp: { configured: boolean };
  ownerCall: { configured: boolean };
}

function disconnectedStatus(): IntegrationStatus {
  return {
    ok: true,
    voice: { mode: "sample", configured: false, number: null, signatureValidation: false },
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
          typeof value.voice.signatureValidation !== "boolean" ||
          typeof value.whatsapp.configured !== "boolean" ||
          typeof value.ownerCall.configured !== "boolean"
        ) {
          throw new Error("invalid integration status");
        }
        if (active) {
          setStatus({
            ok: true,
            voice: {
              mode: value.voice.mode === "farm" ? "farm" : "sample",
              configured: value.voice.configured,
              number: typeof value.voice.number === "string" ? value.voice.number : null,
              signatureValidation: value.voice.signatureValidation,
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

  const account = useIsAccount();
  const lineNumber = status?.voice.number;
  const dialNumber = lineNumber?.replace(/[^+\d]/g, "");
  const phone = m.integrations.phone;
  const summary = !status
    ? phone.checking
    : !status.voice.configured
      ? phone.notConnectedShort
      : status.voice.mode === "sample"
        ? phone.sampleShort
        : lineNumber
          ? phone.connected
          : phone.almostReady;
  return (
    <SettingsDisclosure id="settings-phone" title={phone.title} summary={summary}>
      <div className="space-y-3 text-sm leading-relaxed text-muted">
        {status && !status.voice.configured ? <p>{account ? phone.notConnectedAccount : phone.notConnected}</p> : null}
        {status?.voice.configured && lineNumber && dialNumber ? (
          <a
            href={`tel:${dialNumber}`}
            className="inline-flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 font-semibold text-brown underline decoration-stone underline-offset-4 hover:decoration-brown focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown"
          >
            <span>{phone.callNow}</span>
            <bdi className="ltr-nums">{lineNumber}</bdi>
          </a>
        ) : null}
        {status?.voice.configured && status.voice.mode === "sample" ? <p>{phone.sampleLine}</p> : null}
        {status?.voice.configured && !lineNumber ? <p>{phone.numberMissing}</p> : null}
        {status?.voice.configured && !status.voice.signatureValidation ? <p>{phone.signatureValidationOff}</p> : null}
        {status?.voice.configured && status.ownerCall.configured ? <p>{phone.ownerCall}</p> : null}
        {status?.voice.configured && status.whatsapp.configured ? <p>{phone.whatsapp}</p> : null}
      </div>
    </SettingsDisclosure>
  );
}
