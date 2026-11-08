# Realtime voice (Twilio Media Streams)

Natural-speech report calls. Off unless `NAQAH_VOICE_ENGINE=realtime`; unset, the scripted `<Gather>` call runs unchanged.
Report calls only (NAQAH calling the primary worker). Inbound calls and owner calls stay scripted.

## Rule

The existing conversation engine (`src/domain/conversation/engine.ts`) stays the state machine. The model only turns
speech into a structured answer for the current question and phrases the turn. It never writes data: every answer goes
through `answer()` against `session.replies`, and the report is saved by the existing `worker_report` event
(`parseVoiceEvent` / `applyVoiceEvent`, idempotent on `${callSid}:report`).

## Flow

1. The worker answers. `answerReportCall` runs as today (marks the run answered, creates the `voice_call_sessions` row at
   the first question). With realtime on it returns:
   `<Response><Connect action="{PUBLIC_BASE}/api/voice/realtime/after?s={call token}"><Stream url="{NAQAH_BRIDGE_PUBLIC_URL}"><Parameter name="ticket" value="{ticket}"/></Stream></Connect></Response>`
2. The bridge validates `X-Twilio-Signature` on the WebSocket upgrade, waits for Twilio's `start` message, then calls
   `POST /api/voice/realtime/session` with the ticket and the `callSid` from `start`.
3. Audio runs between Twilio and the voice provider as G.711 mu-law. On worker speech: Twilio `clear`, truncate and cancel
   the response (barge-in).
4. Each model tool call is forwarded to `POST /api/voice/realtime/tool`.
5. When the WebSocket closes while the call is still up, Twilio fetches the `<Connect action>`:
   `POST /api/voice/realtime/after` (signed webhook, call token). Session done → goodbye and `<Hangup/>`. Not done (provider or
   bridge failure) → the scripted `<Gather>` resumes at the current question, using the same session row.
6. A hang-up triggers the existing status callback: `report_call_ended` if nothing was saved.

## Internal API (bridge → Next)

Headers: `x-naqah-bridge-timestamp` (ms) and `x-naqah-bridge-signature` = hex HMAC-SHA256 of `${timestamp}.${rawBody}`, key =
HMAC-SHA256(`NAQAH_VOICE_SECRET`, `"naqah-bridge-internal"`). Reject if outside ±60 s or the signature differs (timing-safe).

`POST /api/voice/realtime/session`
Body `{ "ticket": string, "callSid": string }`.
200 `{ "instructions": string, "tools": [...], "opening": string, "locale": "ar"|"en", "maxSeconds": number }`.
403 for a bad, expired, reused or mismatched ticket. The ticket is single use, enforced by Next.

`POST /api/voice/realtime/tool`
Body `{ "ticket": string, "callSid": string, "toolCallId": string, "name": string, "args": object, "userSpokeSinceLastTool": boolean }`.
200 `{ "output": string, "awaitingConfirmation": boolean, "end": null | "hangup" | "fallback", "goodbye": string | null }`.
`output` is the JSON text returned to the model. A repeated `toolCallId` returns the first result without re-applying.

The tool schemas come from Next, so the bridge stays schema-agnostic.

## Tools

- `answer_question { value?: string, text?: string }`: `value` must be in the current `replies`; `text` only where the step
  takes free text or numbers. Invalid → `output` says so with the allowed values; state unchanged.
- `confirm_report { confirmed: boolean }`: only at `report_summary`. `confirmed: true` also requires
  `userSpokeSinceLastTool` to be true, so a model can't confirm on the worker's behalf.
- `end_call { reason: "worker_ended" | "cannot_continue" }`: ends without saving.

## Bridge behaviour

Track `userSpokeSinceLastTool`: reset when a tool result returns, set when the provider commits user speech. Limits: close
10 s after upgrade with no `start`; close at `maxSeconds`; close after sustained silence. On any provider error or disconnect,
close the Twilio socket (the flow falls back through step 5). Logs carry the call SID's last 6 characters, event names and
counts; never phone numbers, audio, transcripts or secrets.

## Environment

| Variable | Used by | Notes |
|---|---|---|
| `NAQAH_VOICE_ENGINE` | Next | `realtime` to enable |
| `NAQAH_BRIDGE_PUBLIC_URL` | both | `wss://…/voice-bridge/media`; realtime stays off if unset |
| `OPENAI_API_KEY` | bridge | server only |
| `NAQAH_VOICE_SECRET`, `TWILIO_AUTH_TOKEN` | both | already configured |
| `NAQAH_BRIDGE_UPSTREAM` | bridge | Next's local origin |

## Running locally

The bridge listens on 3300 and proxies ordinary HTTP to Next on 3301, keeping one public ngrok address. Vercel can't host
WebSockets, so production needs a separately hosted bridge; that needs owner approval.
