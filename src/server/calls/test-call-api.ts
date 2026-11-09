export type TestCallStatus = "calling" | "ringing" | "connected" | "completed" | "failed";
export type TestCallResult = "report_saved" | "no_report" | "no_answer" | "busy" | "failed" | "canceled" | "timed_out";
export type TestCallFailure = "saudi_calls_disabled" | "provider_rejected" | "number_rejected" | "network_error" | "not_placed";
export type TestCallError = "unavailable" | "unauthenticated" | "forbidden" | "invalid_request" | "invalid_number" | "number_not_allowed" | "confirmation_required" | "busy" | "rate_limited" | "no_test_ranch" | "not_configured" | "failed";
export type TestCallBlocker = "no_test_ranch" | "not_configured" | "no_allowlist";
export interface TestCallView {
  id: string;
  status: TestCallStatus;
  destination: string;
  startedAt: string;
  endedAt: string | null;
  result: TestCallResult | null;
  failure: TestCallFailure | null;
  reportSaved: boolean;
}
export type TestCallResponse =
  | { ok: false; error: TestCallError }
  | { ok: true; call: TestCallView }
  | { ok: true; ready: boolean; blockers: TestCallBlocker[]; call: TestCallView | null };
