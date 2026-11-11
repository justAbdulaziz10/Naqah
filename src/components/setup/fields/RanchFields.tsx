"use client";

import { useState } from "react";
import { useI18n } from "@/i18n/client";
import { regionForCoords, SAUDI_REGIONS } from "@/lib/geo/regions";
import type { SetupFieldsProps } from "../types";
import { FieldGroup, PhoneField, StepField, StepInput, StepSelect } from "../onboarding/WizardParts";
import { isSaudiMobile } from "../phone";
import { ConfirmedPhone } from "./TeamFields";

/**
 * LOCAL DEMO build only (--owner-call-now with --owner-approves): in Settings the owner approves their own number for
 * test calls the way a worker's number is approved, with one confirmation and their agreement.
 */
const OWNER_APPROVES_OWN_NUMBER = process.env.NEXT_PUBLIC_NAQAH_DEMO_OWNER_CALL === "1" && process.env.NEXT_PUBLIC_NAQAH_OWNER_APPROVES_NUMBERS === "1";

/** Ranch name (required), region (optional), then the owner's name and mobile. Shared by onboarding and Settings. */
export function RanchFields({ ws, onChange, showErrors = false, confirmPhone = false }: SetupFieldsProps & { confirmPhone?: boolean }) {
  const { m } = useI18n();
  const r = m.setup.ranch;
  const { owner, farm } = ws.settings;
  const region = regionForCoords(farm.coords);
  // Flagged once the owner leaves the field empty, not only when they try to continue. In an account,
  // a cleared name is never sent, so the stored name stays until a new one is typed.
  const [nameTouched, setNameTouched] = useState(false);
  const nameMissing = (showErrors || nameTouched) && !farm.name.trim();
  const optional = <span className="font-normal text-muted"> ({r.optional})</span>;
  const setOwner = (patch: Partial<typeof owner>) =>
    onChange((current) => ({ ...current, settings: { ...current.settings, owner: { ...current.settings.owner, ...patch } } }));
  const setFarm = (patch: Partial<typeof farm>) =>
    onChange((current) => ({ ...current, settings: { ...current.settings, farm: { ...current.settings.farm, ...patch } } }));

  return (
    <div className="space-y-10">
      <div className="grid gap-x-5 gap-y-6 sm:grid-cols-2">
        <StepField label={r.farmName} error={nameMissing ? r.farmNameNeeded : undefined}>
          {({ id, describedBy }) => (
            <StepInput
              id={id}
              dir="auto"
              autoComplete="organization"
              maxLength={200}
              required
              aria-required
              aria-invalid={nameMissing || undefined}
              aria-describedby={describedBy}
              className={nameMissing ? "border-danger" : undefined}
              value={farm.name}
              onChange={(event) => setFarm({ name: event.target.value })}
              onBlur={() => setNameTouched(true)}
            />
          )}
        </StepField>
        <StepField label={<>{r.region}{optional}</>}>
          {({ id }) => (
            <StepSelect
              id={id}
              value={region?.id ?? ""}
              onChange={(event) => {
                const next = SAUDI_REGIONS.find((item) => item.id === event.target.value);
                if (next) setFarm({ location: m.integrations.weather.regions[next.id], coords: { lat: next.lat, lon: next.lon } });
              }}
            >
              {/* A farm placed by device GPS keeps its point; the menu just has no preset for it. */}
              <option value="" disabled>{farm.coords && !region ? farm.location || r.chooseRegion : r.chooseRegion}</option>
              {SAUDI_REGIONS.map((item) => (
                <option key={item.id} value={item.id}>{m.integrations.weather.regions[item.id]}</option>
              ))}
            </StepSelect>
          )}
        </StepField>
      </div>
      <FieldGroup title={r.you}>
        <div className="grid gap-x-5 gap-y-6 sm:grid-cols-2">
          <StepField label={r.ownerName}>
            {({ id }) => <StepInput id={id} dir="auto" autoComplete="name" value={owner.name} onChange={(event) => setOwner({ name: event.target.value })} />}
          </StepField>
          {confirmPhone && OWNER_APPROVES_OWN_NUMBER && isSaudiMobile(owner.phone) ? (
            <ConfirmedPhone label={r.ownerPhone} name={owner.name.trim() || r.ownerName} value={owner.phone} onSave={(phone) => setOwner({ phone })} />
          ) : (
            <PhoneField label={r.ownerPhone} value={owner.phone} showError={showErrors} hint={r.youHint} onChange={(phone) => setOwner({ phone })} />
          )}
        </div>
      </FieldGroup>
    </div>
  );
}
