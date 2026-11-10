"use client";

import { acceptHerdCountProposal, dismissHerdCountProposal, herdCountProposal } from "@/domain/herd";
import type { Workspace } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { toastWhenSaved } from "./toastWhenSaved";
import { useNow, useWorkspaceStore } from "@/store/workspace";

const quietButton =
  "inline-flex min-h-11 items-center rounded-full border border-stone bg-cream px-4 text-sm font-semibold text-espresso transition hover:border-sand hover:bg-cream focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown";

/**
 * The official camel count, owner-controlled, with how many are registered by name. When the
 * worker counted a different number on the last call, the owner can take it or keep theirs;
 * nothing changes on its own.
 */
export function HerdCountFact({ ws, worker, showNamed = true, className }: { ws: Workspace; worker: string; showNamed?: boolean; className?: string }) {
  const { m, fmt } = useI18n();
  const d = m.setup.dashboard;
  const now = useNow();
  const official = ws.settings.herdCount ?? null;
  const proposal = herdCountProposal(ws);
  const update = useWorkspaceStore((state) => state.update);
  const named = ws.camels.length;

  return (
    <div className={className}>
      <p className="flex flex-wrap items-baseline gap-x-2 text-espresso">
        <span className="text-[1.75rem] font-semibold leading-none tracking-[-0.01em]">
          {official === null ? m.app.overview.herdNotCounted : <bdi className="ltr-nums">{fmt.number(official)}</bdi>}
        </span>
        {official === null ? null : <span className="font-medium">{m.app.overview.camelsWord(official)}</span>}
        {named && showNamed ? <span className="text-sm text-muted">· {m.app.herd.count(fmt.number(named))}</span> : null}
      </p>
      {proposal ? (
        <div aria-live="polite" className={cn("mt-3 border-s-2 border-sand ps-3")}>
          <p className="text-sm text-espresso">{d.proposal(worker, fmt.number(proposal.reported))}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={quietButton} onClick={() => { update((current) => acceptHerdCountProposal(current, now)); toastWhenSaved(m.app.overview.countAccepted(fmt.number(proposal.reported))); }}>
              {d.accept(fmt.number(proposal.reported))}
            </button>
            <button type="button" className={quietButton} onClick={() => { update((current) => dismissHerdCountProposal(current, now)); toastWhenSaved(official === null ? m.app.overview.countDismissed : m.app.overview.countKept(fmt.number(official))); }}>
              {official === null ? d.dismiss : d.keep(fmt.number(official))}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
