import type { Locale, Workspace } from "@/domain/types";
import { createDemoWorkspace } from "@/domain/seed";

const sampleId = (index: number) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;

/**
 * The sample ranch for an owner whose own setup isn't finished. The contract only takes UUIDs, so
 * its ids are replaced by position: the same on every request, as a Lab turn reloads the ranch.
 */
export function sampleLabWorkspace(locale: Locale, now: Date): Workspace {
  const demo = createDemoWorkspace(locale, "ultimate", now);
  const camels = demo.camels.map((camel, index) => ({ ...camel, id: sampleId(index) }));
  const taskTickets = demo.taskTickets.map((task, index) => ({ ...task, id: sampleId(1000 + index) }));
  return { ...demo, camels, taskTickets };
}


export const farmReady = (ws: Workspace) => ws.setupComplete && Boolean(ws.settings.worker.name.trim() && ws.settings.owner.name.trim());
