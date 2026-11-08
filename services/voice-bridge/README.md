# Realtime voice bridge

Plain Node 24 ESM; no Next.js or TypeScript build step. The contract is
`docs/integrations/realtime-voice.md`. This directory contains the bridge and its
isolated tests only. It does not enable realtime calls, change TwiML, save reports,
call Twilio's REST API, or provision/deploy anything.

## Run

After installing the root project's dependencies, with the required environment
already injected by the operator:

```sh
node services/voice-bridge/index.mjs
```

Do not enable the voice engine or run this against real calls without owner
approval. The bridge never reads or loads `.env` files.

- Required: `NAQAH_BRIDGE_PUBLIC_URL` (exact `wss://host/voice-bridge/media`),
  `TWILIO_AUTH_TOKEN`, `NAQAH_VOICE_SECRET`, `OPENAI_API_KEY`.
- Optional: `PORT` (3300), `NAQAH_BRIDGE_UPSTREAM` (HTTP(S) origin, default
  `http://127.0.0.1:3301`). Missing/invalid configuration prevents listening.
- Tests only: `NAQAH_REALTIME_URL` replaces the provider URL **only** for a
  loopback `ws://` destination. `localhost` is pinned to `127.0.0.1`, avoiding
  DNS resolution; IPv4 loopback and `[::1]` are supported. No remote or TLS
  override, credentials, redirects, or fragment is accepted. Use a dummy API key.
- `GET /voice-bridge/health` returns only `{"ok":true}`. It is process liveness,
  not a paid provider probe.
- Every other ordinary HTTP request streams to the upstream with its original
  method, raw URL, body, headers (including Host and duplicates), and trailers.
  Response status, headers, body, and trailers stream back. Host and forwarded
  headers are deliberately not rewritten; configure the upstream accordingly.
- Only `/voice-bridge/media` accepts upgrades. The public URL must match the URL
  in TwiML, not the local HTTP origin. Reverse proxies must preserve the
  `X-Twilio-Signature` header and WebSocket path.

## Protocol and security

Verified against the official documentation on November 8, 2026:

- [OpenAI WebSocket connection](https://developers.openai.com/api/docs/guides/voice-websockets?api=realtime)
  and [gpt-realtime-2.1 model](https://developers.openai.com/api/docs/models/gpt-realtime-2.1):
  `wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1`, with the server-only
  `Authorization: Bearer ...` header. No obsolete `OpenAI-Beta` header.
- [OpenAI Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations)
  and [Realtime client events](https://developers.openai.com/api/reference/resources/realtime/client-events):
  GA `session.update`, `session.updated`, `audio.input/output.format.type =
  "audio/pcmu"`, voice `marin`, and server VAD. PCMU is G.711 mu-law at 8 kHz;
  no resampling, base64 alteration, WAV headers, or transcription is necessary.
  `create_response` and `interrupt_response` are false so the bridge explicitly
  sequences `response.create` and `response.cancel` without auto-cancel races.
  VAD still emits speech events and commits audio.
- `input_audio_buffer.append` carries inbound audio; `response.output_audio.delta`
  carries outbound audio. `response.function_call_arguments.done` supplies the
  tool's `call_id`, `name`, and JSON arguments. The bridge posts these unchanged
  to Next, creates a `function_call_output` conversation item with the same
  `call_id` and returned output string, then requests another response after
  both the current response and pending tools finish. No tool schema or domain
  decision is embedded in the bridge.
- [Twilio Media Streams messages](https://www.twilio.com/docs/voice/media-streams/websocket-messages):
  validates `start`, the call/stream IDs, ticket and mono 8 kHz mu-law format.
  Sends raw base64 `media`, then an individual `mark` for at most 200 ms of
  output. A returned mark acknowledges the corresponding played bytes.
- [Twilio Media Streams security](https://www.twilio.com/docs/voice/media-streams#communicate-with-twilios-media-servers)
  and [Twilio request validation](https://www.twilio.com/docs/usage/security#validating-requests):
  checks `X-Twilio-Signature` **before** accepting the upgrade. For the bodyless
  WebSocket GET, HMAC-SHA1 covers the exact configured public **wss URL**, with
  no form fields. Twilio `customParameters` belong to the later `start` event,
  not this signature. It never trusts Host/Forwarded headers, converts `wss` to
  `https`, or signs the local URL. Comparison is timing-safe. The documented
  trailing-slash validation variant is also accepted, but not a different path
  or origin. The upgrade path itself remains exact.

The reference Python file uses a different Live URL/model/event protocol. This
implementation deliberately uses the documented Realtime GA protocol above;
it does not mix Live `session.start` / `session.input_audio.append` events with
Realtime events. Both implement the same application-side bridge contract.

## Playback, tools, and fallback

The bridge waits for `session.updated`, requests the supplied opening verbatim
(tools disabled for that turn), and then flushes bounded early input audio.
Only `input_audio_buffer.committed` grants `userSpokeSinceLastTool`; speech-start
events or transcripts do not. Every returned tool result resets the flag,
including `awaitingConfirmation: true`. Duplicate provider tool events are
ignored; Next remains the source of truth for tool-call idempotency.

On VAD speech start the bridge sends Twilio `clear`, explicitly cancels any
in-flight response, and truncates unplayed assistant items using
`conversation.item.truncate` with `content_index` and `audio_end_ms` derived
from acknowledged mu-law bytes (8 bytes/ms). This intentionally conservative
acknowledgement bound may discard up to 200 ms of already-played audio when
the next mark has not returned yet. Marks returned because of `clear` are
discarded and never miscounted as played. Late deltas from a cancelled response
are ignored. Already-completed but still-buffered audio is truncated too,
without an invalid cancel against a completed response.

On `end: "hangup"` or `"fallback"`, a nonempty goodbye is requested verbatim
with tools disabled. The bridge waits for response completion and an additional
final Twilio mark, or the goodbye timeout, before closing. A null/empty goodbye
closes immediately. No Twilio REST hangup occurs: closing lets the existing
`<Connect action>` decide between scripted fallback and completed-call hangup.

Both internal POSTs sign the **exact** JSON body with the contract's two-stage
HMAC-SHA256 (binary derived key), millisecond timestamp headers, and no redirect
following. Non-200, invalid/oversized response, timeout, provider error,
disconnect, failed model response, malformed audio, or backpressure closes
Twilio promptly. There are no retries.

Production bounds (test code can inject shorter durations):

- No valid start: 10 s; internal API: 5 s; provider upgrade: 5 s;
  provider session acknowledgement: another 5 s.
- Model response: 45 s; goodbye including playback: 15 s.
- Silence: 45 s without VAD speech/commit, output audio, or playback mark.
  Continuous Twilio silence frames do not keep the watchdog alive.
- Total session: Next's `maxSeconds`, validated as positive and at most 3600 s.
- Incoming Twilio message: 64 KiB; provider message/internal JSON: 256 KiB;
  one inbound audio chunk: 16 KiB decoded; pre-ready audio: 80 KiB decoded.
- Socket queued-write high-water bound: 256 KiB; pending playback marks: 1024;
  unique tool calls: 128. Closing handshake is forcibly terminated after 250 ms.
- One active stream per `callSid` per bridge process. Run one bridge process
  for this deployment; distributed duplicate suppression is not implemented.

Logs contain only static event names, a call SID's last six characters and
numeric frame/tool counts. No provider error body, ticket, transcript, audio,
phone number, headers, full call SID, URL credentials, or API keys are logged.

## Test without paid services

```sh
node --test services/voice-bridge/bridge.test.mjs
npx eslint services/voice-bridge/*.mjs
```

Tests supply only dummy credentials and local mock upstream/provider/Twilio
connections. Ports 3901–3905 are used, with sequential tests and complete
teardown; no production port, ngrok, external OpenAI connection or Twilio API is
used. No Next build is required. The root Vitest configuration only includes
`src/**/*.test.ts`; run this separate Node suite explicitly.
