# Voice data contract (v1)

How the telephony layer (Twilio + voice model) reports to the farm. Code:
`src/server/voice/contract.ts`. Not connected to the live voice routes yet.

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
| `worker_report` | `draft` (`ReportDraft`) | `routeWorkerInboundCall`, then `completeWorkerReport` or `rejectWorkerReport` |
| `worker_callback` | none | `completeWorkerCallback`; not a farm update |
| `task_confirmation` | `taskId`, `done`, `via` | `confirmTask`; only the worker's confirmation closes a task |
| `owner_inquiry` | none | `routeOwnerInboundCall`, then `recordOwnerInquiry` or `rejectOwnerInquiry` |
| `owner_instruction` | `message`, `actionable`, `scheduledFor` | `submitOwnerInstruction` |
| `owner_notification` | `reportId`, `answered` | `recordOwnerNotification` |
| `task_verification_start` | `taskId` | `startTaskVerification`, once per task |
| `worker_call_attempt` | `pendingCallId`, `answered` | `resolveWorkerCallAttempt` (20 min × 3, then No Answer ticket) |

The first three come from the worker's call, the next two from the owner's, and the last three
from the system (scheduler and Twilio status callbacks).

`draft` holds `answers`, `camelUpdates`, `resourceUpdates`, `herdAccountedFor`,
`taskConfirmations` and an optional `heatWaterNeeded` flag. The server writes the heat-day finding
itself; findings sent by the voice layer are ignored. Each answer carries a certainty label: `reported`, `approximate`, `unknown`
or `verified`. «ما أدري» is a valid answer with certainty `unknown`.

## Outcomes

| `status` | Meaning | What the agent does |
|---|---|---|
| `saved` | Stored. `detail` holds the attempt result where relevant. | May confirm it |
| `unchanged` | Nothing needed saving | Says nothing was changed |
| `rejected` | `reason`: `outside_window`, `weekly_done`, `daily_done`, `no_window`, `allowance_used`, `callback_required`, `not_allowed` | Explains politely |

Errors are `DbError` codes. `invalid_input` means a bad event. `not_found`, `conflict` or
`unavailable` mean nothing was saved: the agent must not claim it was.

A retried event returns its first outcome and changes nothing, including an event that changed
nothing the first time. If a farm changes during a save,
the server reloads and runs the rules again, up to three times.

## Scheduler

Every few minutes, using the service client: load each farm with due work. For each task in
`tasksToVerify`, send `task_verification_start`. Then place the calls in `dueWorkerCalls` and report
each result as `worker_call_attempt`. `pending_worker_calls_due` indexes the query. Use one `eventId`
per attempt.

Each task gets one automatic verification call. After that it is asked about during the worker's
own calls. Use `tasksToVerify`, not `dueTaskVerifications`, which keeps finished tasks eligible.

## Changing the contract

Add optional fields freely. Anything else needs a new `version`, and both sides must deploy it.
