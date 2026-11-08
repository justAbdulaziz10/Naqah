import type { AnswerInput } from "@/domain/conversation/engine";

type TurnDiagnostic = {
  callSid: string;
  seq: number;
  speech: string;
  digits: string | null;
  confidence?: string | null;
};

const RIYADH_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Riyadh", hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3,
});

type CallProgress = { callSid: string; status: string; sequence: string | null; timestamp: string | null; sip: string | null };

/**
 * One line per Twilio call-progress event, in Riyadh time. `status=ringing` is Twilio's signal
 * from the carrier; it does not prove the handset physically rang.
 */
export function logCallProgress(event: CallProgress, receivedAt: Date): void {
  const call = /^CA[0-9a-f]{32}$/i.test(event.callSid) ? event.callSid.slice(-6) : "invalid";
  const status = /^[a-z-]{1,20}$/.test(event.status) ? event.status : "invalid";
  const sequence = /^\d{1,4}$/.test(event.sequence ?? "") ? event.sequence : "absent";
  const sip = /^\d{3}$/.test(event.sip ?? "") ? event.sip : "absent";
  const twilioTime = Date.parse(event.timestamp ?? "");
  const twilioRiyadh = Number.isFinite(twilioTime) ? RIYADH_TIME.format(twilioTime) : "absent";
  console.info(`[NAQAH] call progress call=${call} status=${status} seq=${sequence} sip=${sip} twilio_riyadh=${twilioRiyadh} received_riyadh=${RIYADH_TIME.format(receivedAt)}`);
}

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
