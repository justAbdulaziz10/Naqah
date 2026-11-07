"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import { PencilSimple, Plus } from "@phosphor-icons/react";
import { CamelEditorDialog, type CamelFormValues } from "@/components/dashboard/CamelEditorDialog";
import { CertaintyBadge, EmptyState, HealthBadge } from "@/components/dashboard/DashboardPrimitives";
import { useHashTarget } from "@/components/dashboard/useHashTarget";
import { Button, Card, ConfirmDialog, Field, IconButton, Input, Segmented } from "@/components/ui";
import { uid } from "@/domain/id";
import { CERTAINTY_LABELS } from "@/domain";
import type { Camel } from "@/domain";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { useNow, useWorkspace, useWorkspaceStore } from "@/store/workspace";

type HerdFilter = "all" | "attention" | "healthy";

const concern: Record<Camel["health"], number> = { sick: 0, watch: 1, unknown: 2, healthy: 3 };

export default function HerdPage() {
  const { m, t, fmt, locale } = useI18n();
  const ws = useWorkspace();
  const now = useNow();
  const [filter, setFilter] = useState<HerdFilter>("all");
  const [search, setSearch] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Camel | null>(null);
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
    }).sort((a, b) => concern[a.health] - concern[b.health]);
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

  function askToRemove() {
    const camel = editingCamel;
    setEditorOpen(false);
    setEditingId(null);
    setRemoving(camel);
  }

  function removeCamel() {
    const id = removing?.id;
    setRemoving(null);
    useWorkspaceStore.getState().update((current) => ({
      ...current,
      camels: current.camels.filter((item) => item.id !== id),
    }));
    requestAnimationFrame(() => addButtonRef.current?.focus());
  }

  const describe = (camel: Camel) =>
    [
      camel.sex === "female" ? m.app.herd.female : m.app.herd.male,
      camel.ageYears === null ? m.app.herd.ageUnknown : m.app.herd.ageYears(fmt.number(camel.ageYears)),
      camel.tag,
    ].filter(Boolean).join(" · ");

  const updated = (camel: Camel) =>
    camel.updatedAt ? m.app.herd.updated(fmt.relative(camel.updatedAt, now)) : m.app.herd.neverUpdated;

  // Most camels share one source and time, so it is said once and only exceptions show on a row.
  const usual = (values: string[]) => {
    const counts = new Map<string, number>();
    values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  const usualCertainty = usual(ws.camels.map((camel) => camel.certainty)) as Camel["certainty"] | null;
  const usualUpdate = usual(ws.camels.map(updated));

  const provenance = (camel: Camel) => {
    const certainty = camel.certainty !== usualCertainty;
    const time = updated(camel) !== usualUpdate;
    if (!certainty && !time) return null;
    return (
      <span className="mt-0.5 flex flex-wrap gap-x-2 text-[0.8125rem] text-muted">
        {certainty ? <CertaintyBadge certainty={camel.certainty} /> : null}
        {time ? <span>{updated(camel)}</span> : null}
      </span>
    );
  };

  const herdCount = ws.settings.herdCount;
  const parts = (values: (string | null | false)[]) => values.filter((part): part is string => Boolean(part));
  const counts = parts([
    Boolean(herdCount) && m.app.herd.total(fmt.number(herdCount ?? 0)),
    ws.camels.length > 0 && m.app.herd.count(fmt.number(ws.camels.length)),
  ]);
  const source = parts([
    ws.camels.length > 0 && usualCertainty && t(CERTAINTY_LABELS[usualCertainty]),
    ws.camels.length > 0 && usualUpdate,
  ]);
  const line = (values: string[]) => values.map((part, index) => (
    <Fragment key={part}>
      {index ? <span aria-hidden> · </span> : null}
      <span className="whitespace-nowrap">{part}</span>
    </Fragment>
  ));

  const editButton = (camel: Camel) => (
    <IconButton
      label={`${m.common.actions.edit} ${camel.name}`}
      className="min-h-11 min-w-11 shrink-0"
      onClick={(event) => {
        dialogTriggerRef.current = event.currentTarget;
        setEditingId(camel.id);
        setEditorOpen(true);
      }}
    >
      <PencilSimple size={18} aria-hidden />
    </IconButton>
  );

  return (
    <div className="space-y-4 pb-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-espresso sm:text-[1.8rem]">{m.app.herd.title}</h1>
          {counts.length ? <p className="mt-1 text-sm text-espresso">{line(counts)}</p> : null}
          {source.length ? <p className="mt-0.5 text-sm text-muted">{line(source)}</p> : null}
        </div>
        {ws.camels.length ? (
          <Button ref={addButtonRef} className="w-full sm:w-auto" onClick={openNewCamel}>
            <Plus size={18} weight="fill" aria-hidden />
            {m.app.herd.addCamel}
          </Button>
        ) : null}
      </header>

      {ws.camels.length ? (
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
      ) : null}

      {ws.camels.length === 0 ? (
        <Card>
          <EmptyState
            camel
            title={m.app.herd.noCamelsTitle}
            action={<Button ref={addButtonRef} onClick={openNewCamel}><Plus size={17} weight="fill" aria-hidden />{m.app.herd.addCamel}</Button>}
          />
        </Card>
      ) : visibleCamels.length === 0 ? (
        <Card><EmptyState title={m.app.herd.noResults} /></Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="hidden w-full border-collapse text-start md:table">
            <thead>
              <tr className="border-b border-stone/70 text-sm text-muted">
                <th scope="col" className="px-6 py-3 text-start font-medium">{m.app.herd.name}</th>
                <th scope="col" className="px-3 py-3 text-start font-medium">{m.app.herd.health}</th>
                <th scope="col" className="px-3 py-3 text-start font-medium">{m.app.herd.healthNote}</th>
                <th scope="col" className="w-16 px-3 py-3"><span className="sr-only">{m.common.actions.edit}</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone/70">
              {visibleCamels.map((camel) => (
                <tr key={camel.id} data-hash-target={`camel-${camel.id}`} tabIndex={-1} className={cn("align-top transition-colors hover:bg-ivory/50 focus:outline-none", linkedCamelId === camel.id && "bg-ivory")}>
                  <th scope="row" className="px-6 py-3.5 text-start font-normal">
                    <span className="block text-lg font-semibold leading-snug text-espresso">{camel.name}</span>
                    <span className="mt-0.5 block text-sm text-muted">{describe(camel)}</span>
                  </th>
                  <td className="whitespace-nowrap px-3 py-4">
                    <HealthBadge health={camel.health} />
                    {provenance(camel)}
                  </td>
                  <td className="px-3 py-4 text-sm leading-relaxed text-espresso">{camel.healthNote || <><span className="text-muted" aria-hidden>—</span><span className="sr-only">{m.app.herd.noHealthNote}</span></>}</td>
                  <td className="px-3 py-2.5 text-end">{editButton(camel)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <ul className="divide-y divide-stone/70 md:hidden">
            {visibleCamels.map((camel) => (
              <li key={camel.id} data-hash-target={`camel-${camel.id}`} tabIndex={-1} className={cn("flex items-start justify-between gap-3 px-5 py-4 focus:outline-none", linkedCamelId === camel.id && "bg-ivory")}>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold leading-snug text-espresso">{camel.name}</h2>
                  <div className="mt-0.5"><HealthBadge health={camel.health} /></div>
                  {camel.healthNote ? <p className="mt-1.5 text-sm leading-relaxed text-espresso">{camel.healthNote}</p> : null}
                  <p className="mt-1.5 text-sm text-muted">{describe(camel)}</p>
                  {provenance(camel)}
                </div>
                {editButton(camel)}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <CamelEditorDialog
        key={editorOpen ? editingId ?? "new" : "closed"}
        open={editorOpen}
        camel={editingCamel}
        onClose={closeEditor}
        onSave={saveCamel}
        onRemove={askToRemove}
      />
      {removing ? (
        <ConfirmDialog
          title={m.app.herd.removeConfirm(removing.name)}
          body={m.app.herd.removeBody}
          confirmLabel={m.app.herd.removeCamel}
          cancelLabel={m.common.actions.cancel}
          onConfirm={removeCamel}
          onCancel={() => {
            setRemoving(null);
            requestAnimationFrame(() => addButtonRef.current?.focus());
          }}
        />
      ) : null}
    </div>
  );
}
