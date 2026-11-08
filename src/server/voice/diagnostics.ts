import type { AnswerInput } from "@/domain/conversation/engine";

type TurnDiagnostic = {
  callSid: string;
  seq: number;
  speech: string;
  digits: string | null;
  confidence?: string | null;
};

export function logVoiceTurn(turn: TurnDiagnostic, outcome: AnswerInput | "missing_session" | "duplicate" | "stale" | null): void {
  const call = /^CA[0-9a-f]{32}$/i.test(turn.callSid) ? turn.callSid.slice(-6) : "invalid";
  const seq = Number.isSafeInteger(turn.seq) && turn.seq >= 0 ? turn.seq : "invalid";
  const empty = !turn.speech.trim();
  const kind = turn.digits ? "dtmf" : empty ? "empty" : "speech";
  const score = turn.confidence === undefined || turn.confidence === null ? null : Number(turn.confidence);
  const validScore = score !== null && Boolean(turn.confidence?.trim()) && Number.isFinite(score) && score >= 0 && score <= 1;
  const confidence = score === null ? "absent" : validScore ? String(score) : "invalid";
  const parsed = typeof outcome === "string" ? outcome : outcome ? outcome.value ? "choice" : "text" :
    kind === "empty" ? "empty" : "unmapped";
  console.info(`[NAQAH] voice turn call=${call} turn=${seq} input=${kind} confidence=${confidence} speech_empty=${empty} parse=${parsed}`);
}
