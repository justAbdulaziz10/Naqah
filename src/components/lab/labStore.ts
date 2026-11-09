import { create } from "zustand";
import type { CallSession } from "@/domain/conversation/engine";

export type PickerScenario = "report_call" | "worker_inbound" | "worker_outbound" | "owner_inquiry" | "emergency";

export function scenarioMessageKey(scenario: PickerScenario) {
  switch (scenario) {
    case "report_call": return "reportCall";
    case "worker_inbound": return "workerInbound";
    case "worker_outbound": return "workerOutbound";
    case "owner_inquiry": return "ownerInquiry";
    case "emergency": return "emergency";
  }
}

interface LabCallState {
  selected: PickerScenario;
  session: CallSession | null;
  workspaceKey: string | null;
  baseline: string[];
  callStartedAt: number | null;
  patch: (value: Partial<Omit<LabCallState, "patch">>) => void;
}

export const useLabCall = create<LabCallState>()((set) => ({
  selected: "report_call",
  session: null,
  workspaceKey: null,
  baseline: [],
  callStartedAt: null,
  patch: (value) => set(value),
}));
