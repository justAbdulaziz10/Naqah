"use client";

import { useMemo, useRef, useState } from "react";
import { PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { CamelEditorDialog, type CamelFormValues } from "@/components/dashboard/CamelEditorDialog";
import { CertaintyBadge, EmptyState, HealthBadge } from "@/components/dashboard/DashboardPrimitives";
import { useHashTarget } from "@/components/dashboard/useHashTarget";
import { Button, Card, Field, IconButton, Input, Segmented } from "@/components/ui";
import { uid } from "@/domain/id";
import type { Camel } from "@/domain";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { useNow, useWorkspace, useWorkspaceStore } from "@/store/workspace";

type HerdFilter = "all" | "attention" | "healthy";

export default function HerdPage() {
  const { m, fmt, locale } = useI18n();
  const ws = useWorkspace();
  const now = useNow();
  const [filter, setFilter] = useState<HerdFilter>("all");
  const [search, setSearch] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const dialogTriggerRef = useRef<HTMLElement | null>(null);

  const linkedCamelId = useHashTarget("camel-", Boolean(ws));

  const editingCamel = ws?.camels.find((camel) => camel.id === editingId) ?? null;
  const visibleCamels = useMemo(() => {
    if (!ws) return [];
    const normalized = search.trim().toLocaleLowerCase(locale);
    return ws.camels.filter((camel) => {
      const matchesFilter = filter === "all" || (filter === "healthy" ? camel.health === "healthy" : camel.health !== "healthy");
      const matchesSearch = !normalized || `${camel.name} ${camel.tag}`.toLocaleLowerCase(locale).includes(normalized);
      return matchesFilter && matchesSearch;
    });
  }, [filter, locale, search, ws]);

  if (!ws) return null;

  function openNewCamel() {
    dialogTriggerRef.current = addButtonRef.current;
    setEditingId(null);
    setEditorOpen(true);
  }

  function closeEditor() {
    setEditorOpen(false);
    setEditingId(null);
    requestAnimationFrame(() => dialogTriggerRef.current?.focus());
  }

  function saveCamel(values: CamelFormValues) {
    const id = editingId;
    const updatedAt = now.toISOString();
    useWorkspaceStore.getState().update((current) => {
      if (id) {
        return {
          ...current,
          camels: current.camels.map((camel) =>
            camel.id !== id
              ? camel
              : camel.health === values.health && camel.healthNote === values.healthNote
                ? { ...camel, ...values } // Name, sex or age only: the health record keeps its source and time.
                : { ...camel, ...values, certainty: "verified", updatedAt },
          ),
        };
      }
      const camel: Camel = { id: uid("cml"), ...values, tag: "", certainty: "verified", updatedAt };
      return { ...current, camels: [...current.camels, camel] };
    });
    closeEditor();
  }

  function removeCamel(camel: Camel) {
    if (!window.confirm(m.app.herd.removeConfirm(camel.name))) return;
    useWorkspaceStore.getState().update((current) => ({
      ...current,
      camels: current.camels.filter((item) => item.id !== camel.id),
    }));
    requestAnimationFrame(() => addButtonRef.current?.focus());
  }

  return (
    <div className="space-y-5 pb-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-espresso sm:text-[1.8rem]">{m.app.herd.title}</h1>
          <p className="mt-1 text-sm text-muted">{m.app.herd.count(fmt.number(ws.camels.length))}</p>
        </div>
        <Button ref={addButtonRef} className="w-full sm:w-auto" onClick={openNewCamel}>
          <Plus size={18} weight="fill" aria-hidden />
          {m.app.herd.addCamel}
        </Button>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented
          value={filter}
          onChange={setFilter}
          label={m.app.herd.filterLabel}
          className="w-full justify-between [&>button]:min-h-11 sm:w-auto sm:justify-start"
          options={[
            { value: "all", label: m.app.herd.all },
            { value: "attention", label: m.app.herd.attention },
            { value: "healthy", label: m.app.herd.healthyFilter },
          ]}
        />
        <Field label={m.app.herd.search} className="w-full sm:max-w-xs">
          {(id) => <Input id={id} type="search" value={search} onChange={(event) => setSearch(event.target.value)} />}
        </Field>
      </div>

      {ws.camels.length === 0 ? (
        <Card>
          <EmptyState
            camel
            title={m.app.herd.noCamelsTitle}
            body={m.app.herd.noCamelsBody}
            action={<Button onClick={openNewCamel}><Plus size={17} weight="fill" aria-hidden />{m.app.herd.addCamel}</Button>}
          />
        </Card>
      ) : visibleCamels.length === 0 ? (
        <Card><EmptyState title={m.app.herd.noResults} /></Card>
      ) : (
        <ul className="grid gap-3">
          {visibleCamels.map((camel) => (
            <li key={camel.id} id={`camel-${camel.id}`} tabIndex={-1} className="rounded-2xl focus:outline-none">
              <Card className={cn("px-4 py-4 sm:px-5", linkedCamelId === camel.id && "border-brown")}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
                      <h2 className="text-lg font-bold leading-tight">{camel.name}</h2>
                      {camel.tag ? <span className="text-sm font-medium text-muted ltr-nums">{camel.tag}</span> : null}
                      <HealthBadge health={camel.health} />
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-muted">
                      {camel.healthNote || m.app.herd.noHealthNote}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <IconButton
                      label={`${m.common.actions.edit} ${camel.name}`}
                      className="min-h-11 min-w-11"
                      onClick={(event) => {
                        dialogTriggerRef.current = event.currentTarget;
                        setEditingId(camel.id);
                        setEditorOpen(true);
                      }}
                    >
                      <PencilSimple size={18} aria-hidden />
                    </IconButton>
                    <IconButton
                      label={`${m.app.herd.removeCamel} ${camel.name}`}
                      className="min-h-11 min-w-11 text-danger"
                      onClick={() => removeCamel(camel)}
                    >
                      <Trash size={18} aria-hidden />
                    </IconButton>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-stone/70 pt-3 text-sm">
                  <span className="text-muted">{camel.sex === "female" ? m.app.herd.female : m.app.herd.male}</span>
                  <span className="text-muted">{camel.ageYears === null ? m.app.herd.ageUnknown : m.app.herd.ageYears(fmt.number(camel.ageYears))}</span>
                  <CertaintyBadge certainty={camel.certainty} />
                  <span className="text-xs text-muted">
                    {camel.updatedAt ? m.app.herd.updated(fmt.relative(camel.updatedAt, now)) : m.app.herd.neverUpdated}
                  </span>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <CamelEditorDialog
        key={editorOpen ? editingId ?? "new" : "closed"}
        open={editorOpen}
        camel={editingCamel}
        onClose={closeEditor}
        onSave={saveCamel}
      />
    </div>
  );
}
