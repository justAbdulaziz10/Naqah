"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { CaretRight, MagnifyingGlass, Plus } from "@phosphor-icons/react";
import { CamelEditorDialog, type CamelFormValues } from "@/components/dashboard/CamelEditorDialog";
import { CamelSheet } from "@/components/dashboard/CamelSheet";
import { CertaintyBadge, EmptyState, HealthBadge } from "@/components/dashboard/DashboardPrimitives";
import { HerdCountFact } from "@/components/dashboard/HerdCountFact";
import { GroupLabel, PageHeader } from "@/components/dashboard/PageHeader";
import { toastWhenSaved } from "@/components/dashboard/toastWhenSaved";
import { useHashTarget } from "@/components/dashboard/useHashTarget";
import { HERD_DOTS_MAX, HerdDots } from "@/components/visuals/HerdDots";
import { HerdComposition } from "@/components/visuals/HerdComposition";
import { Button, Card, ConfirmDialog, Input } from "@/components/ui";
import { uid } from "@/domain/id";
import type { Camel } from "@/domain";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { useNow, useWorkspace, useWorkspaceStore } from "@/store/workspace";

type Group = "attention" | "unknown" | "healthy";
const GROUPS: Group[] = ["attention", "unknown", "healthy"];
const groupOf = (camel: Camel): Group => (camel.health === "sick" || camel.health === "watch" ? "attention" : camel.health === "unknown" ? "unknown" : "healthy");
const concern: Record<Camel["health"], number> = { sick: 0, watch: 1, unknown: 2, healthy: 3 };

export default function HerdPage() {
  const { m, fmt, locale } = useI18n();
  const h = m.app.herd;
  const ws = useWorkspace();
  const now = useNow();
  const [search, setSearch] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Camel | null>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const linkedCamelId = useHashTarget("camel-", Boolean(ws));

  // A link to one camel (from the Overview) opens its sheet once; closing it clears the link.
  const [seenLink, setSeenLink] = useState<string | null>(null);
  if (linkedCamelId !== seenLink) {
    setSeenLink(linkedCamelId);
    if (linkedCamelId) setViewingId(linkedCamelId);
  }

  const editingCamel = ws?.camels.find((camel) => camel.id === editingId) ?? null;
  const viewingCamel = ws?.camels.find((camel) => camel.id === viewingId) ?? null;
  // Search results are announced once typing pauses, including "none", without moving focus.
  const [announced, setAnnounced] = useState("");
  const searching = search.trim();
  const visibleCount = useMemo(() => {
    if (!ws) return 0;
    const needle = searching.toLocaleLowerCase(locale);
    return ws.camels.filter((camel) => !needle || `${camel.name} ${camel.tag}`.toLocaleLowerCase(locale).includes(needle)).length;
  }, [locale, searching, ws]);
  useEffect(() => {
    const timer = setTimeout(() => setAnnounced(searching ? h.searchResults(visibleCount) : ""), 500);
    return () => clearTimeout(timer);
  }, [h, searching, visibleCount]);

  const visible = useMemo(() => {
    if (!ws) return [];
    const needle = search.trim().toLocaleLowerCase(locale);
    return ws.camels
      .filter((camel) => !needle || `${camel.name} ${camel.tag}`.toLocaleLowerCase(locale).includes(needle))
      .sort((a, b) => concern[a.health] - concern[b.health]);
  }, [locale, search, ws]);

  if (!ws) return null;
  const worker = ws.settings.worker.name.trim() || m.app.overview.unnamedWorker;

  function clearLink() {
    if (window.location.hash) history.replaceState(null, "", window.location.pathname + window.location.search);
  }

  function openNewCamel() {
    setEditingId(null);
    setEditorOpen(true);
  }

  function editFromSheet() {
    const id = viewingId;
    setViewingId(null);
    clearLink();
    setEditingId(id);
    setEditorOpen(true);
  }

  function closeEditor() {
    setEditorOpen(false);
    setEditingId(null);
    requestAnimationFrame(() => addButtonRef.current?.focus());
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
    toastWhenSaved(id ? h.savedToast(values.name) : h.addedToast(values.name));
    closeEditor();
  }

  function askToRemove() {
    const camel = editingCamel;
    setEditorOpen(false);
    setEditingId(null);
    setRemoving(camel);
  }

  function removeCamel() {
    const camel = removing;
    setRemoving(null);
    useWorkspaceStore.getState().update((current) => ({ ...current, camels: current.camels.filter((item) => item.id !== camel?.id) }));
    if (camel) toastWhenSaved(h.removedToast(camel.name));
    requestAnimationFrame(() => addButtonRef.current?.focus());
  }

  const describe = (camel: Camel) =>
    [camel.sex === "female" ? h.female : h.male, camel.ageYears === null ? h.ageUnknown : h.ageYears(fmt.number(camel.ageYears))].join(" · ");

  const herdCount = ws.settings.herdCount;
  const dots = Math.max(herdCount ?? 0, ws.camels.length) <= HERD_DOTS_MAX;

  return (
    <div className="naqah-page space-y-6 pb-8">
      <PageHeader
        title={h.title}
        action={(
          <Button ref={addButtonRef} className="w-full sm:w-auto" onClick={openNewCamel}>
            <Plus size={18} weight="bold" aria-hidden />
            {h.addCamel}
          </Button>
        )}
      >
        <HerdCountFact ws={ws} worker={worker} className="mt-2" />
      </PageHeader>

      {ws.camels.length || herdCount ? (
        <Card className="grid gap-x-12 gap-y-7 px-5 py-6 sm:px-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          {dots ? (
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-muted">{h.wholeHerd}</h2>
              <HerdDots camels={ws.camels} herdCount={herdCount} className="mt-3" />
            </div>
          ) : null}
          {ws.camels.length ? (
            <div className={cn("min-w-0", !dots && "lg:col-span-2")}>
              <h2 className="text-sm font-semibold text-muted">{h.ofNamed(fmt.number(ws.camels.length))}</h2>
              <HerdComposition camels={ws.camels} rows={dots ? ["type", "age"] : undefined} className="mt-3" />
            </div>
          ) : null}
        </Card>
      ) : null}

      {ws.camels.length === 0 ? (
        <Card>
          <EmptyState camel title={h.noCamelsTitle} body={h.noCamelsBody} />
        </Card>
      ) : (
        <>
          <div className="relative w-full sm:max-w-xs">
            <label htmlFor="herd-search" className="sr-only">{h.search}</label>
            <MagnifyingGlass size={18} className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
            <Input id="herd-search" type="search" placeholder={h.search} className="ps-11" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
          <p role="status" className="sr-only">{announced}</p>

          {visible.length === 0 ? (
            <Card><EmptyState title={h.noResults} /></Card>
          ) : (
            <div className="space-y-6">
              {GROUPS.map((group) => {
                const camels = visible.filter((camel) => groupOf(camel) === group);
                if (!camels.length) return null;
                return (
                  <section key={group} aria-labelledby={`herd-${group}`}>
                    <GroupLabel id={`herd-${group}`} count={fmt.number(camels.length)}>{h.groups[group]}</GroupLabel>
                    <Card className={cn("naqah-stagger overflow-hidden", group === "healthy" ? "grid gap-px bg-stone/70 sm:grid-cols-2" : "divide-y divide-stone/70")}>
                      {camels.map((camel, index) => (
                        <button
                          key={camel.id}
                          type="button"
                          data-hash-target={`camel-${camel.id}`}
                          aria-haspopup="dialog"
                          onClick={() => setViewingId(camel.id)}
                          style={{ "--i": index } as CSSProperties}
                          className={cn(
                            "group flex min-h-16 w-full items-center gap-4 px-5 py-4 text-start transition-colors duration-200 hover:bg-ivory/70 active:bg-ivory sm:px-7",
                            group === "healthy" && "bg-cream sm:last:odd:col-span-2",
                            linkedCamelId === camel.id && "bg-ivory",
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                              <span className={cn("font-semibold leading-snug text-espresso", group === "healthy" ? "text-base" : "text-lg")}>{camel.name}</span>
                              {group === "healthy" ? null : <HealthBadge health={camel.health} />}
                            </span>
                            {camel.healthNote && group !== "healthy" ? <span className="mt-1 block leading-relaxed text-espresso">{camel.healthNote}</span> : null}
                            <span className="mt-0.5 flex flex-wrap gap-x-2 text-sm text-muted">
                              <span>{describe(camel)}</span>
                              {group === "attention" ? (
                                <>
                                  <span aria-hidden>·</span>
                                  {camel.certainty !== "reported" ? <CertaintyBadge certainty={camel.certainty} /> : null}
                                  <span>{camel.updatedAt ? h.updated(fmt.relative(camel.updatedAt, now)) : h.neverUpdated}</span>
                                </>
                              ) : null}
                            </span>
                          </span>
                          <CaretRight size={18} className="shrink-0 text-faint transition-transform duration-200 group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" aria-hidden />
                        </button>
                      ))}
                    </Card>
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}

      {viewingCamel ? (
        <CamelSheet
          ws={ws}
          camel={viewingCamel}
          onEdit={editFromSheet}
          onClose={() => {
            setViewingId(null);
            clearLink();
          }}
        />
      ) : null}
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
          title={h.removeConfirm(removing.name)}
          body={h.removeBody}
          confirmLabel={h.removeCamel}
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
