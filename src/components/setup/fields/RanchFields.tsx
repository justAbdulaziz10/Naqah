"use client";

import { useI18n } from "@/i18n/client";
import { regionForCoords, SAUDI_REGIONS } from "@/lib/geo/regions";
import type { SetupFieldsProps } from "../types";
import { PhoneField, StepField, StepInput, StepSelect } from "../onboarding/WizardParts";

/** Ranch name, region, and the owner's name and mobile. Shared by onboarding and Settings. */
export function RanchFields({ ws, onChange, showErrors = false }: SetupFieldsProps) {
  const { m } = useI18n();
  const r = m.setup.ranch;
  const { owner, farm } = ws.settings;
  const region = regionForCoords(farm.coords);
  const setOwner = (patch: Partial<typeof owner>) =>
    onChange((current) => ({ ...current, settings: { ...current.settings, owner: { ...current.settings.owner, ...patch } } }));
  const setFarm = (patch: Partial<typeof farm>) =>
    onChange((current) => ({ ...current, settings: { ...current.settings, farm: { ...current.settings.farm, ...patch } } }));

  return (
    <div className="grid gap-x-5 gap-y-6 sm:grid-cols-2">
      <StepField label={r.farmName}>
        {({ id }) => <StepInput id={id} dir="auto" autoComplete="organization" value={farm.name} onChange={(event) => setFarm({ name: event.target.value })} />}
      </StepField>
      <StepField label={r.region} hint={r.regionHint}>
        {({ id, describedBy }) => (
          <StepSelect
            id={id}
            aria-describedby={describedBy}
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
      <StepField label={r.ownerName}>
        {({ id }) => <StepInput id={id} dir="auto" autoComplete="name" value={owner.name} onChange={(event) => setOwner({ name: event.target.value })} />}
      </StepField>
      <PhoneField label={r.ownerPhone} value={owner.phone} showError={showErrors} onChange={(phone) => setOwner({ phone })} />
    </div>
  );
}
