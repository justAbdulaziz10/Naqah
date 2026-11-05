"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { X } from "@phosphor-icons/react";
import type { Camel, HealthStatus } from "@/domain";
import { Button, Field, IconButton, Input, Select, Textarea } from "@/components/ui";
import { useI18n } from "@/i18n/client";

export type CamelFormValues = Pick<Camel, "name" | "sex" | "ageYears" | "health" | "healthNote">;

export function CamelEditorDialog({
  open,
  camel,
  onClose,
  onSave,
}: {
  open: boolean;
  camel: Camel | null;
  onClose: () => void;
  onSave: (values: CamelFormValues) => void;
}) {
  const { m } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(camel?.name ?? "");
  const [sex, setSex] = useState<Camel["sex"]>(camel?.sex ?? "female");
  const [age, setAge] = useState(camel?.ageYears === null || camel?.ageYears === undefined ? "" : String(camel.ageYears));
  const [health, setHealth] = useState<HealthStatus>(camel?.health ?? "unknown");
  const [healthNote, setHealthNote] = useState(camel?.healthNote ?? "");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave({
      name: name.trim(),
      sex,
      ageYears: age.trim() ? Number(age) : null,
      health,
      healthNote: healthNote.trim() || null,
    });
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="camel-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="max-h-[min(90dvh,48rem)] w-[calc(100vw-2rem)] max-w-xl overflow-y-auto rounded-2xl border border-stone bg-cream p-0 text-espresso shadow-lift backdrop:bg-espresso/40"
    >
      <form onSubmit={submit} className="flex max-h-[min(90dvh,48rem)] flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-stone px-5 py-4 sm:px-6">
          <h2 id="camel-dialog-title" className="text-lg font-bold">
            {camel ? m.app.herd.editCamel : m.app.herd.newCamel}
          </h2>
          <IconButton label={m.common.actions.close} className="min-h-11 min-w-11" onClick={onClose}>
            <X size={20} aria-hidden />
          </IconButton>
        </div>

        <div className="grid gap-4 overflow-y-auto px-5 py-5 sm:grid-cols-2 sm:px-6">
          <Field label={m.app.herd.name}>
            {(id) => <Input id={id} autoFocus required value={name} onChange={(event) => setName(event.target.value)} />}
          </Field>
          <Field label={m.app.herd.sex}>
            {(id) => (
              <Select id={id} value={sex} onChange={(event) => setSex(event.target.value as Camel["sex"])}>
                <option value="female">{m.app.herd.female}</option>
                <option value="male">{m.app.herd.male}</option>
              </Select>
            )}
          </Field>
          <Field label={m.app.herd.age} hint={m.app.herd.optional}>
            {(id) => (
              <Input
                id={id}
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={age}
                onChange={(event) => setAge(event.target.value)}
              />
            )}
          </Field>
          <Field label={m.app.herd.health} className="sm:col-span-2">
            {(id) => (
              <Select id={id} value={health} onChange={(event) => setHealth(event.target.value as HealthStatus)}>
                <option value="healthy">{m.app.labels.healthy}</option>
                <option value="watch">{m.app.labels.watch}</option>
                <option value="sick">{m.app.labels.sick}</option>
                <option value="unknown">{m.app.labels.unknown}</option>
              </Select>
            )}
          </Field>
          <Field label={m.app.herd.healthNote} className="sm:col-span-2">
            {(id) => (
              <Textarea
                id={id}
                rows={3}
                placeholder={m.app.herd.notePlaceholder}
                value={healthNote}
                onChange={(event) => setHealthNote(event.target.value)}
              />
            )}
          </Field>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-stone px-5 py-4 sm:px-6">
          <Button variant="secondary" onClick={onClose}>{m.common.actions.cancel}</Button>
          <Button type="submit">{m.common.actions.save}</Button>
        </div>
      </form>
    </dialog>
  );
}
