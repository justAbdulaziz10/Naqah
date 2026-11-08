import type { Workspace } from "@/domain/types";

export type WorkspaceUpdate = (workspace: Workspace) => Workspace;

export interface SetupSectionProps {
  ws: Workspace;
  onChange: (update: WorkspaceUpdate) => void;
  showSaved?: boolean;
}
