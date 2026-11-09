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
Body `{ "ticket": string, "callSid": string, "toolCallId": string, "name": string, "args": object, "userSpokeSinceLastTool": boolean, "workerUtterance"?: string, "heardSummary"?: boolean }`.
200 `{ "output": string, "awaitingConfirmation": boolean, "end": null | "hangup" | "fallback", "goodbye": string | null }`.
`output` is the JSON text returned to the model. A repeated `toolCallId` returns the first result without re-applying.

The tool schemas come from Next, so the bridge stays schema-agnostic.
`answer_question` and `confirm_report` with `confirmed: true` carry the worker's `workerUtterance`; the confirmation also carries `heardSummary`.
The utterance is at most 1,000 characters, with no control characters. It is ephemeral verification input, never model
context, a log field, or stored session/report data. Missing evidence is a refusal, not permission to save.

## Tools

- `answer_question { value?: string, text?: string }`: `value` must be in the current `replies`; `text` only where the step
  takes free text or numbers. A fresh committed worker turn is required (`worker_has_not_answered` otherwise).
  Invalid → `output` says so with the allowed values; state unchanged.
- `confirm_report { confirmed: boolean }`: only at `report_summary`. `confirmed: true` also requires
  fresh worker speech, a transcript that the existing deterministic `mapSpeechToInput` parser maps to `confirm_save`,
  and playback evidence that the worker heard the complete summary before starting that turn. Negation and correction
  wording (including «إيه بس العلف غلط» and «صح لكن») are refused. An interrupted or unfinished summary returns
  `summary_not_finished` with the complete summary to re-read. Other unverified confirmations ask for clear confirmation.
  The engine/draft stay unchanged; only a refusal count and idempotent tool result are retained. Two unique verification
  failures close realtime writes and return `end: "fallback"` for scripted Gather with keypad confirmation.
- `end_call { reason: "worker_ended" | "cannot_continue" }`: ends without saving.

## Bridge behaviour

Track `userSpokeSinceLastTool`: consume it when a tool result returns, set when the provider commits user speech.
Queued tools cannot reuse a consumed turn. Retain only the latest committed worker turn, matched by provider `item_id`;
ignore older completion events. At confirmation only, await its final transcript for up to 2.5 seconds. Failed, missing,
oversized, superseded or late transcripts fail closed, and later completion events cannot revive a consumed turn.

The GA `session.update` enables `session.audio.input.transcription` with `{ model: "gpt-4o-mini-transcribe", language: locale }`.
Handle `conversation.item.input_audio_transcription.completed` and `.failed`, not transcript deltas. This runs asynchronously
for committed input turns, without changing the existing audio-native conversation, minimal reasoning or per-call farm cache.
Transcription adds an estimated $0.003 per input-audio minute across the call, not just at confirmation. Confirmation adds
0–2.5 seconds waiting for ASR (no artificial delay when it has already completed); live latency is not measured by mocks.

The next response after `awaitingConfirmation` is tracked as summary playback. A final Twilio mark after successful response
completion must return without cancellation/clear before a worker turn starts. Marks returned by `clear` are not proof of
listening. A confirmation spoken over the summary remains invalid even if subsequent marks arrive.

If speech remains open for 10 seconds without a stop, issue one `input_audio_buffer.commit`. Only the normal committed event
clears `speaking` and requests the reply. A rejected commit or no commit acknowledgement within 5 seconds closes the stream
for scripted fallback. Normal VAD remains unchanged (500 ms silence); the recovery does not submit an answer or advance the
current question. An interrupted question remains current and must be re-asked if the worker supplied no clear answer.

Session startup requests retain a 5-second internal limit; tool requests allow 13 seconds, exceeding Next's 12-second route
limit rather than abandoning a valid tool at 5 seconds. Realtime row and metadata writes additionally require
`session.realtime.closed = false` atomically. After a slow farm load, the service rechecks the row before planning a save.
After fallback, late writes cannot reopen realtime or advance the scripted turn. On finished calls, `/after` suppresses the
goodbye only for a recorded `saved` result; other endings replay `last_response`, including the honest save-failure message.
Scripted Gather now ends after six consecutive unmatched spoken turns when no unknown-answer fallback is available;
recognized speech or keypad input resets that counter.

Limits: close
10 s after upgrade with no `start`; close at `maxSeconds`; close after sustained silence. On any provider error or disconnect,
close the Twilio socket (the flow falls back through step 5). Logs carry the call SID's last 6 characters, event names and
counts; never phone numbers, audio, transcripts or secrets.

`checkTool(name, args, spoke, session, locale)` remains source-compatible. Its boolean is a verified authorization signal
for `confirm_report`, not merely VAD activity. Voice Lab callers must perform equivalent transcript and playback checks
before passing true; calling `checkTool` directly does not independently verify speech. `answer_question` requires fresh
speech but does not require the confirmation-only transcript fields.

Official references checked November 8, 2026:
- https://developers.openai.com/api/reference/resources/realtime/client-events (`session.update`, `audio.input.transcription`)
- https://developers.openai.com/api/reference/resources/realtime/server-events (completed/failed transcription, commit events)
- https://developers.openai.com/api/docs/pricing (ASR billing is separate from realtime audio)

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

## Known limits (November 2026 integration)

- The bridge counts a summary as heard only when the provider's output transcript matches the summary text. This was
  tested against mocks, not the real model. If the real transcript differs, the call falls back to the scripted keypad path.
- The report is saved before the session row advances (`planTurn`, then `advanceRow`). A confirmed report can land while a
  fallback takes over; it is not lost or duplicated (`${callSid}:report`), but the two are not one transaction.
- Request bodies are bounded before parsing or signature work: Twilio forms are capped at 32 KiB, JSON APIs at 64 KiB, and signed realtime bridge requests at 16 KiB. Oversized requests receive 413. Realtime signatures still cover the exact bounded raw body before JSON parsing.
- Callback-delivered instructions, including grouped messages, receive one scheduled verification cycle per still-open
  task once due. Open No Answer Tickets still block delivery; existing verification cycles prevent duplicates.
  This is covered locally, not proven against live telephony. Missing callback-ticket evidence fails closed; the current
  DB loader's 200-ticket closed-history cap can hide it before a distant due time. See `voice-data-contract.md`.
