import type { Workspace } from "@/domain/types";

export type WorkspaceUpdate = (workspace: Workspace) => Workspace;

export interface SetupSectionProps {
  ws: Workspace;
  onChange: (update: WorkspaceUpdate) => void;
  showSaved?: boolean;
}

/** Field groups shared by onboarding and Settings. `showErrors` flags a wrong entry the owner hasn't left yet. */
export interface SetupFieldsProps {
  ws: Workspace;
  onChange: (update: WorkspaceUpdate) => void;
  showErrors?: boolean;
}
