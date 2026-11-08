import type { Workspace } from "@/domain/types";

/** Server-supplied identity metadata, never authorization or part of the browser demo. */
export type AccountWorkspace = Workspace & { readonly farmId: string; readonly ownerId: string };

export function isAccountWorkspace(workspace: Workspace): workspace is AccountWorkspace {
  const account = workspace as Partial<AccountWorkspace>;
  return typeof account.farmId === "string" && !!account.farmId && typeof account.ownerId === "string" && !!account.ownerId;
}
