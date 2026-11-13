"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { MagnifyingGlass, Plus } from "@phosphor-icons/react";
import { CamelEditorDialog, type CamelFormValues } from "@/components/dashboard/CamelEditorDialog";
import { CamelRow } from "@/components/dashboard/CamelRow";
import { CamelSheet } from "@/components/dashboard/CamelSheet";
import { EmptyState } from "@/components/dashboard/DashboardPrimitives";
import { HerdCountFact } from "@/components/dashboard/HerdCountFact";
import { GroupLabel, PageHeader } from "@/components/dashboard/PageHeader";
import { toastWhenSaved } from "@/components/dashboard/toastWhenSaved";
import { useHashTarget } from "@/components/dashboard/useHashTarget";
import { HERD_DOTS_MAX, HerdDots } from "@/components/visuals/HerdDots";
import { HerdComposition } from "@/components/visuals/HerdComposition";
import { HERD_MARKS_MAX, HerdMarks } from "@/components/visuals/HerdMarks";
import { Button, Card, ConfirmDialog, Input, Segmented } from "@/components/ui";
import { uid } from "@/domain/id";
import type { Camel } from "@/domain";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { useNow, useWorkspace, useWorkspaceStore } from "@/store/workspace";

type Group = "attention" | "unknown" | "healthy";
const GROUPS: Group[] = ["attention", "unknown", "healthy"];
const groupOf = (camel: Camel): Group => (camel.health === "sick" || camel.health === "watch" ? "attention" : camel.health === "unknown" ? "unknown" : "healthy");
const concern: Record<Camel["health"], number> = { sick: 0, watch: 1, unknown: 2, healthy: 3 };
type Filter = "all" | "attention" | "female" | "male";
const passes = (camel: Camel, filter: Filter) =>
  filter === "all" || (filter === "attention" ? groupOf(camel) === "attention" : camel.sex === filter);
/** Search and filter controls only help once the list is longer than a glance. */
const LIST_TOOLS_FROM = 7;

export default function HerdPage() {
  const { m, fmt, locale } = useI18n();
  const h = m.app.herd;
  const ws = useWorkspace();
  const now = useNow();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
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
    return ws.camels.filter((camel) => passes(camel, filter) && (!needle || `${camel.name} ${camel.tag}`.toLocaleLowerCase(locale).includes(needle))).length;
  }, [filter, locale, searching, ws]);
  useEffect(() => {
    const timer = setTimeout(() => setAnnounced(searching ? h.searchResults(visibleCount) : ""), 500);
    return () => clearTimeout(timer);
  }, [h, searching, visibleCount]);

  const visible = useMemo(() => {
    if (!ws) return [];
    const needle = search.trim().toLocaleLowerCase(locale);
    return ws.camels
      .filter((camel) => passes(camel, filter) && (!needle || `${camel.name} ${camel.tag}`.toLocaleLowerCase(locale).includes(needle)))
      .sort((a, b) => concern[a.health] - concern[b.health]);
  }, [filter, locale, search, ws]);

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

  const herdCount = ws.settings.herdCount;
  const camels = ws.camels;
  const attention = camels.filter((camel) => groupOf(camel) === "attention").sort((a, b) => concern[a.health] - concern[b.health]);
  const unknown = camels.filter((camel) => camel.health === "unknown").length;
  const healthy = camels.filter((camel) => camel.health === "healthy").length;
  const marks = camels.length > 0 && camels.length <= HERD_MARKS_MAX;
  const dots = !marks && Math.max(herdCount ?? 0, camels.length) <= HERD_DOTS_MAX;
  const females = camels.filter((camel) => camel.sex === "female").length;
  const tools = camels.length >= LIST_TOOLS_FROM;
  const filters: { value: Filter; label: string; count: number }[] = [
    { value: "all" as const, label: h.all, count: camels.length },
    { value: "attention" as const, label: h.filterAttention, count: attention.length },
    ...(females && females < camels.length ? [
      { value: "female" as const, label: h.female_plural, count: females },
      { value: "male" as const, label: h.male_plural, count: camels.length - females },
    ] : []),
  ].filter((option) => option.value === "all" || option.count > 0);
  // A filter that is no longer offered (the list got short, or nothing is left in it) falls back to everything.
  if (filter !== "all" && (!tools || !filters.some((option) => option.value === filter))) setFilter("all");

  // One sentence that answers "is the herd all right?", from the recorded health only. Names sit in <bdi>, so an
  // Arabic name inside the English sentence keeps its place.
  const a = h.answer;
  const NAMES = "\u2063";
  const needs = (who: string, many: boolean, male: boolean) => (many ? a.needsMany : male ? a.needsOneMale : a.needsOne)(who);
  const answer = (() => {
    if (!camels.length) return null;
    let names: string[] = [];
    let sentence: string;
    if (camels.length === 1) {
      const [camel] = camels;
      names = [camel.name];
      sentence = attention.length ? needs(NAMES, false, camel.sex === "male") : camel.health === "healthy" ? a.oneWell(NAMES) : a.oneNoNews(NAMES);
    } else {
      const parts: string[] = [];
      if (attention.length) {
        if (attention.length <= 3) names = attention.map((camel) => camel.name);
        parts.push(needs(names.length ? NAMES : a.manyWho(fmt.number(attention.length)), attention.length > 1, attention[0].sex === "male"));
        if (healthy) parts.push(a.well(fmt.number(healthy)));
      } else {
        if (!unknown) parts.push(a.nothing);
        if (healthy) parts.push(a.well(fmt.number(healthy)));
        if (unknown) parts.push(a.noNews(fmt.number(unknown)));
      }
      sentence = parts.join(a.join);
      sentence = sentence.charAt(0).toLocaleUpperCase(locale) + sentence.slice(1);
    }
    const [before, after = ""] = sentence.split(NAMES);
    if (!names.length) return sentence;
    const list = new Intl.ListFormat(locale, { type: "conjunction" }).formatToParts(names);
    return (
      <>
        {before}
        {list.map((part, index) => (part.type === "element" ? <bdi key={index} className="font-semibold">{part.value}</bdi> : part.value))}
        {after}
      </>
    );
  })();

  return (
    <div className="naqah-page space-y-8 pb-8">
      <PageHeader
        title={h.title}
        answer={answer}
        action={(
          <Button ref={addButtonRef} variant="secondary" size="sm" className="self-start" onClick={openNewCamel}>
            <Plus size={18} weight="bold" aria-hidden />
            {h.addCamel}
          </Button>
        )}
      />

      {camels.length || herdCount ? (
        <Card className="px-5 py-6 sm:px-7">
          <HerdCountFact ws={ws} worker={worker} />
          {marks ? (
            <HerdMarks camels={camels} herdCount={herdCount} activeId={viewingId} onOpen={setViewingId} className="mt-6" />
          ) : dots ? (
            <div className="mt-6">
              <h2 className="text-sm font-semibold text-muted">{h.wholeHerd}</h2>
              <HerdDots camels={camels} herdCount={herdCount} className="mt-3" />
            </div>
          ) : null}
          {camels.length > 1 ? (
            <div className="mt-6 grid gap-x-12 gap-y-5 border-t border-stone/70 pt-6 lg:grid-cols-2">
              <HerdComposition camels={camels} rows={["type"]} />
              <HerdComposition camels={camels} rows={["age"]} />
            </div>
          ) : null}
        </Card>
      ) : null}

      {camels.length === 0 ? (
        <Card>
          <EmptyState camel title={h.noCamelsTitle} body={h.noCamelsBody} />
        </Card>
      ) : (
        <>
          {tools ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              {filters.length > 1 ? (
                <div className="max-w-full overflow-x-auto">
                  <Segmented
                    label={h.filterLabel}
                    value={filter}
                    onChange={setFilter}
                    options={filters.map((option) => ({
                      value: option.value,
                      label: <>{option.label}<span className="ms-1.5 hidden text-muted sm:inline">{fmt.number(option.count)}</span></>,
                    }))}
                  />
                </div>
              ) : <span />}
              <div className="relative w-full sm:max-w-xs">
                <label htmlFor="herd-search" className="sr-only">{h.search}</label>
                <MagnifyingGlass size={18} className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
                <Input id="herd-search" type="search" placeholder={h.search} className="ps-11" value={search} onChange={(event) => setSearch(event.target.value)} />
              </div>
            </div>
          ) : null}
          <p role="status" className="sr-only">{announced}</p>

          {visible.length === 0 ? (
            <Card><EmptyState title={filter === "attention" && !searching ? h.noneFollowed : h.noResults} /></Card>
          ) : (
            <div className="space-y-8">
              {GROUPS.map((group) => {
                const list = visible.filter((camel) => groupOf(camel) === group);
                if (!list.length) return null;
                const compact = group === "healthy";
                return (
                  <section key={group} aria-labelledby={`herd-${group}`}>
                    <GroupLabel id={`herd-${group}`} count={fmt.number(list.length)}>{h.groups[group]}</GroupLabel>
                    <Card className={cn("naqah-stagger overflow-hidden", compact ? "grid gap-px bg-stone/70 sm:grid-cols-2" : "divide-y divide-stone/70")}>
                      {list.map((camel, index) => (
                        <div key={camel.id} style={{ "--i": Math.min(index, 16) } as CSSProperties} className={cn("flex", compact && "bg-cream sm:last:odd:col-span-2")}>
                          <CamelRow
                            ws={ws}
                            camel={camel}
                            now={now}
                            compact={compact}
                            highlighted={linkedCamelId === camel.id}
                            onOpen={() => setViewingId(camel.id)}
                          />
                        </div>
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
