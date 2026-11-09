import type { LabToolResult, LabView } from "./agent";
import type { LabSource } from "./state";
import type { LabPricing } from "@/components/voice-lab/usage";

export type VoiceLabErrorCode =
  | "unavailable"
  | "forbidden"
  | "auth_unavailable"
  | "unauthenticated"
  | "invalid_input"
  | "payload_too_large"
  | "farm_unavailable"
  | "not_configured"
  | "rate_limited"
  | "session_expired"
  | "provider_failed"
  | "server_error";

export type VoiceLabStatusSuccessBody = { model: string; configured: boolean; source: LabSource; ranch: string; worker: string; queue: string[] };
export type VoiceLabOpenSuccessBody = {
  answer: string;
  state: string;
  closeState: string;
  opening: string;
  view: LabView;
  source: LabSource;
  model: string;
  pricing: LabPricing | null;
  maxSeconds: number;
};
export type VoiceLabToolSuccessBody = Omit<LabToolResult, "session"> & { state: string };
export type VoiceLabSuccessBody = VoiceLabStatusSuccessBody | VoiceLabOpenSuccessBody | VoiceLabToolSuccessBody;

export type VoiceLabSuccessResponse = ({ ok: true } & VoiceLabSuccessBody) | { ok: true };
export type VoiceLabFailureResponse = { ok: false; error: VoiceLabErrorCode; provider?: string };
export type VoiceLabApiResponse = VoiceLabSuccessResponse | VoiceLabFailureResponse;
