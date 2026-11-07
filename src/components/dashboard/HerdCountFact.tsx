"use client";

import { acceptHerdCountProposal, dismissHerdCountProposal, herdCountProposal } from "@/domain/herd";
import type { Workspace } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { useNow, useWorkspaceStore } from "@/store/workspace";

const quietButton =
  "inline-flex min-h-11 items-center rounded-full border border-cream/35 px-4 text-sm font-semibold text-cream transition hover:bg-cream/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream";

/**
 * The official camel count, owner-controlled. When the worker counted a different number on the last
 * call, the owner can take it or keep theirs; nothing changes on its own.
 */
export function HerdCountFact({ ws, worker }: { ws: Workspace; worker: string }) {
  const { m, fmt } = useI18n();
  const d = m.setup.dashboard;
  const now = useNow();
  const official = ws.settings.herdCount ?? null;
  const proposal = herdCountProposal(ws);
  const update = useWorkspaceStore((state) => state.update);

  return (
    <>
      <p className="text-lg font-semibold leading-snug">
        {official === null ? d.herdNotSet : d.camels(fmt.number(official))}
      </p>
      {proposal ? (
        <div aria-live="polite" className="mt-1">
          <p className="text-sm text-cream/75">{d.proposal(worker, fmt.number(proposal.reported))}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={quietButton} onClick={() => update((current) => acceptHerdCountProposal(current, now))}>
              {d.accept(fmt.number(proposal.reported))}
            </button>
            <button type="button" className={quietButton} onClick={() => update((current) => dismissHerdCountProposal(current, now))}>
              {official === null ? d.dismiss : d.keep(fmt.number(official))}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
