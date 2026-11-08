# Voice data contract (v1)

How the telephony layer (Twilio + voice model) reports to the farm. Code:
`src/server/voice/contract.ts`. Used by the live routes when `NAQAH_VOICE_MODE=farm`, through
`src/server/voice/farm-call.ts`. See `twilio-activation.md`.

## Flow

1. A call arrives. `findCaller(client, phone)` returns `worker`, `owner` or `unknown`.
2. The server loads the farm and tells the agent what to ask, using the domain rules
   (`routeWorkerInboundCall`, `routeOwnerInboundCall`, `applicableQuestions`).
3. The model phrases the turns. For each outcome the voice layer sends one event.
4. `parseVoiceEvent` validates it and `applyVoiceEvent` saves it in one transaction.
5. **The agent says "saved" only after step 4 returns `saved`.**

## Trust rules

- **No farm id or time in events.** The server resolves the farm from the verified call and uses
  its own clock, so a model or a replayed webhook can't choose either.
- **Events are bound to the call.** The server passes who is on the call (`VoiceContext`), and an
  event from the wrong party is refused with `not_allowed`. Only the worker can close a task, and
  instructions are taken on the post-update call only (open decision 6).
- **Caller ID identifies, it doesn't prove.** A number matching more than one farm, or both a
  worker and an owner, is `unknown` and writes nothing.
- **Facts only.** No audio, recording or transcript fields exist. Disable Twilio recording.
- **Verify the Twilio signature** before parsing. Events from anywhere else are refused.
- **Model output is untrusted.** Unknown types, fields out of range and non-UUID ids are rejected.

## Envelope

```json
{ "version": 1, "eventId": "CA123:report", "providerCallId": "CA123", "type": "worker_report" }
```

| Field | Meaning |
|---|---|
| `version` | Contract version. Other values are rejected. |
| `eventId` | Unique per outcome, stable across retries. One call can carry several events. Max 128. |
| `providerCallId` | Twilio CallSid, stored on the call log for support. |

## Events

| `type` | Extra fields | Domain function |
|---|---|---|
| `worker_report` | `draft` (`ReportDraft`), optional `refusedAtStart`, optional `reportCallId` | With `reportCallId` (a report call NAQAH placed): the run must be answered, then `completeWorkerReport(…, runId)`. Without it (the worker phoned in): `routeWorkerInboundCall`, then `completeWorkerReport` or `rejectWorkerReport`. `refusedAtStart` logs a refused call and can never save a report |
| `report_call_ended` | `reportCallId`, optional `attempt` | `endReportCallWithoutReport`; with `attempt`, a call that never reached the questions counts as unanswered |
| `worker_callback` | none | `completeWorkerCallback`; not a farm update |
| `task_confirmation` | `taskId`, `done`, `via` | `confirmTask`; only the worker's confirmation closes a task |
| `owner_inquiry` | none | `routeOwnerInboundCall`, then `recordOwnerInquiry` or `rejectOwnerInquiry` |
| `owner_instruction` | `message`, `actionable`, `scheduledFor`. Optional `items` (the approved list) and `deliveryMessage` (what the worker hears). A single instruction omits `items` and still uses `submitOwnerInstruction`. | `submitOwnerInstruction`, or `submitOwnerInstructionBatch` when `items` is present. One batch is one worker call and, on Ultimate, one Task Ticket per actionable item. The same `eventId` is the batch id, so a retry does not create a second call. |
| `owner_notification` | `reportId`, `answered` | `recordOwnerNotification` |
| `task_verification_start` | `taskId` | `startTaskVerification`, once per task |
| `worker_call_attempt` | `pendingCallId`, `answered` | `resolveWorkerCallAttempt` (20 min × 3, then No Answer ticket) |
| `report_call_attempt` | `reportCallId`, `attempt`, `answered` | `resolveReportCallAttempt` (20 min × 2 retries, then missed); a callback for another attempt is ignored |

`worker_report`, `worker_callback` and `task_confirmation` come from the worker's call;
`owner_inquiry` and `owner_instruction` from the owner's; `owner_notification`,
`task_verification_start`, `worker_call_attempt` and `report_call_attempt` from the system (scheduler
and Twilio status callbacks). `report_call_ended` comes from either the worker (ended unsaved) or
the system (final status). Every event naming a `reportCallId` also stores the CallSid on that run.

`draft` holds `answers`, `camelUpdates`, `resourceUpdates`, `herdAccountedFor`,
`taskConfirmations`, an optional `herdCount` (integer 0–100000, the worker's count: a proposal for
the owner, saved as `reports.herd_count_reported`) and an optional `heatWaterNeeded` flag. The server writes the heat-day finding
itself; findings sent by the voice layer are ignored. Each answer carries a certainty label: `reported`, `approximate`, `unknown`
or `verified`. «ما أدري» is a valid answer with certainty `unknown`.

## Outcomes

| `status` | Meaning | What the agent does |
|---|---|---|
| `saved` | Stored. `detail` holds the attempt result where relevant. | May confirm it |
| `unchanged` | Nothing needed saving | Says nothing was changed |
| `rejected` | `reason`: `wait_for_call`, `weekly_done`, `daily_done`, `allowance_used`, `callback_required`, `call_not_active`, `not_allowed` (`outside_window` / `no_window` are retired) | Explains politely |

Errors are `DbError` codes. `invalid_input` means a bad event. `not_found`, `conflict` or
`unavailable` mean nothing was saved: the agent must not claim it was.

The live routes use one `eventId` per outcome: `<CallSid>:report`, `:callback`, `:inquiry`,
`:task:<taskId>`, `:answered`, `:ended`, `:final` and `:owner`.

A retried event returns its first outcome and changes nothing, including an event that changed
nothing the first time. If a farm changes during a save,
the server reloads and runs the rules again, up to three times.

## Scheduler

Report calls are built: `GET /api/cron/report-calls` (see `twilio-activation.md`). Not yet built,
for instruction and task calls: every few minutes, using the service client, load each farm with due work. For each task in
`tasksToVerify`, send `task_verification_start`. Then place the calls in `dueWorkerCalls` and report
each result as `worker_call_attempt`. `pending_worker_calls_due` indexes the query. Use one `eventId`
per attempt.

Each task gets one automatic verification call. After that it is asked about during the worker's
own calls. `dueTaskVerifications` already excludes a task that has any verification call, or whose
instruction is still undelivered. `tasksToVerify` is the scheduler's list.

## Gemini conversation agent

Team B can drive a call without replacing the scripted engine or the Twilio routes. The public
surface is `openAgentCall` and `agentTurn` in `src/server/gemini/agent.ts`, with
`liveGeminiClient()` from `src/server/gemini/client.ts`.

- One model request per turn. There is no retry. The request aborts after `GEMINI_TIMEOUT_MS`
  (8s), inside the 12s webhook limit.
- A plain `نعم` or `لا` on a confirmation stage does not call the model. `نعم` accepts the
  pending point. `لا` rejects it. Neither writes a report or an instruction by itself.
- Pass a `SaveHandler` that calls `voiceStep` / `applyVoiceEvent`. The agent says the update was
  saved only when that handler returns `saved`. The default handler is in-memory `voiceStep`.
- Text languages are `ar`, `en`, `ur`, `hi`, `bn`, and `fil`. Live phone languages stay `ar` and `en`.
- The current Twilio routes still use the scripted engine. Connecting them is Team B's change.

## Team A: batch fields are not stored

`PendingWorkerCall.batchId` and `coveredTaskIds` exist only in memory. `pending_worker_calls` has
`task_ticket_id` and `relay_id`, and `toRows` writes those, not the batch fields. After a Supabase
reload, a multi-ticket instruction still has one call row, but the link from that call to every
covered ticket is gone, so `dueTaskVerifications` can treat those tickets as eligible again. A
retried voice event still does not create a second batch, because the event id is the batch id.
Persisting the two fields needs a Team A migration. This change does not add one.

## Changing the contract

Add optional fields freely. Anything else needs a new `version`, and both sides must deploy it.
