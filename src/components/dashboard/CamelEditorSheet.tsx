"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { Camel, HealthStatus } from "@/domain";
import { Button, Field, Input, Select, Sheet, Textarea } from "@/components/ui";
import { useI18n } from "@/i18n/client";

export type CamelFormValues = Pick<Camel, "name" | "sex" | "ageYears" | "health" | "healthNote">;

/**
 * Add or edit one camel, in the same sheet the herd uses for details: it rises from the bottom on
 * phones and slides in from the end edge on wider screens. Mount it only while editing. Saving and
 * cancelling leave the way the sheet came; removing hands over to the confirm dialog at once.
 */
export function CamelEditorSheet({
  camel,
  swap = false,
  onClose,
  onSave,
  onRemove,
}: {
  camel: Camel | null;
  /** Opened from the camel's detail sheet, so it takes that sheet's place without sliding in again. */
  swap?: boolean;
  onClose: () => void;
  onSave: (values: CamelFormValues) => void;
  onRemove: () => void;
}) {
  const { m } = useI18n();
  const h = m.app.herd;
  const formId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(camel?.name ?? "");
  const [sex, setSex] = useState<Camel["sex"]>(camel?.sex ?? "female");
  const [age, setAge] = useState(camel?.ageYears === null || camel?.ageYears === undefined ? "" : String(camel.ageYears));
  const [health, setHealth] = useState<HealthStatus>(camel?.health ?? "unknown");
  const [healthNote, setHealthNote] = useState(camel?.healthNote ?? "");

  // The sheet opens on its close button; the first field is where typing starts.
  useEffect(() => {
    const frame = requestAnimationFrame(() => nameRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);

  function submit(event: FormEvent<HTMLFormElement>, close: () => void) {
    event.preventDefault();
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      sex,
      ageYears: age.trim() ? Number(age) : null,
      health,
      healthNote: healthNote.trim() || null,
    });
    close();
  }

  return (
    <Sheet
      title={camel ? camel.name : h.newCamel}
      description={camel ? h.editCamel : undefined}
      closeLabel={m.common.actions.close}
      onClose={onClose}
      swap={swap}
      footer={(close) => (
        <div className="flex flex-col-reverse gap-3 sm:flex-row-reverse sm:items-center sm:justify-between">
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
            <Button variant="secondary" onClick={close}>{m.common.actions.cancel}</Button>
            <Button type="submit" form={formId} className="px-6">{m.common.actions.save}</Button>
          </div>
          {camel ? <Button variant="ghost" className="text-danger!" onClick={onRemove}>{h.removeCamel}</Button> : null}
        </div>
      )}
    >
      {(close) => (
        <form id={formId} onSubmit={(event) => submit(event, close)} className="grid gap-5 pt-1">
          <Field label={h.name}>
            {(id) => <Input id={id} ref={nameRef} required value={name} onChange={(event) => setName(event.target.value)} />}
          </Field>
          <div className="grid grid-cols-[7fr_5fr] gap-x-4 gap-y-5">
            <Field label={h.sex}>
              {(id) => (
                <Select id={id} value={sex} onChange={(event) => setSex(event.target.value as Camel["sex"])}>
                  <option value="female">{h.female}</option>
                  <option value="male">{h.male}</option>
                </Select>
              )}
            </Field>
            <Field label={h.age} hint={h.optional}>
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={0}
                  max={60}
                  step={1}
                  inputMode="numeric"
                  value={age}
                  onChange={(event) => setAge(event.target.value)}
                />
              )}
            </Field>
          </div>
          <Field label={h.health}>
            {(id) => (
              <Select id={id} value={health} onChange={(event) => setHealth(event.target.value as HealthStatus)}>
                <option value="healthy">{m.app.labels.healthy}</option>
                <option value="watch">{m.app.labels.watch}</option>
                <option value="sick">{m.app.labels.sick}</option>
                <option value="unknown">{m.app.labels.unknown}</option>
              </Select>
            )}
          </Field>
          <Field label={h.healthNote}>
            {(id) => (
              <Textarea
                id={id}
                rows={3}
                maxLength={500}
                placeholder={h.notePlaceholder}
                value={healthNote}
                onChange={(event) => setHealthNote(event.target.value)}
              />
            )}
          </Field>
        </form>
      )}
    </Sheet>
  );
}
