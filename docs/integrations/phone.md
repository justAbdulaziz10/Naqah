# Phone line and report summaries

There are two modes. `NAQAH_VOICE_MODE=farm` is a real call on a real farm in Supabase: see
[twilio-activation.md](twilio-activation.md). This page describes the default **sample line**, which runs the demo
farm, tells the caller it is a sample, and saves nothing.

On a real farm NAQAH calls the worker at the owner's report time (see
[twilio-activation.md](twilio-activation.md#report-calls-naqah-calls-the-worker)). The sample line can't call anyone, so
when the registered worker calls it, it plays a sample of that report call and says so.

The sample line lets a registered worker call NAQAH, answer the scripted report-call flow, and have a labelled sample
summary sent through WhatsApp Cloud API, an outbound Twilio call, or both. Paid sample summaries are sent only after
the completing voice webhook passes Twilio signature validation. It appears in the owner's
**Settings → Connections** section. With no voice configuration, that card says the line is not connected and that
Call Lab simulates calls; if signature validation is off, it says automatic owner summaries are paused.

## Provider setup

### Twilio Voice

1. Confirm that your Twilio account can provision or connect a voice-capable number for Saudi Arabia, and check the
   current [number availability and Saudi Voice pricing](https://www.twilio.com/en-us/voice/pricing/sa) before
   purchasing. Number provisioning can require [regulatory registration and supporting documents](https://www.twilio.com/docs/trust-hub/registrations/regulatory-compliance).
   Voice, numbers, and outbound minutes are paid services; check current provider pricing before enabling calls.
2. Add the phone number to Twilio and configure its **A call comes in** webhook as
   `https://<your-domain>/api/voice/inbound` using **HTTP POST**. Set the status callback URL to
   `https://<your-domain>/api/voice/status`, also using **HTTP POST**.
3. Set `NAQAH_VOICE_SECRET` to a strong random secret, `NAQAH_WORKER_PHONE` to the worker's registered E.164 number,
   and `NEXT_PUBLIC_NAQAH_PHONE_NUMBER` to the purchased number. Set `TWILIO_AUTH_TOKEN` to require signature
   validation on every inbound/turn webhook. Production voice always refuses requests without the token. With no
   token, only the non-production sample line accepts unsigned calls; they never send paid owner summaries.
   Optionally set `NAQAH_OWNER_PHONE`: an owner calling in hears a short closed line (owners do not call NAQAH), and
   with `NAQAH_CALL_OWNER=1` it is where the sample summary call goes.
4. In Vercel project settings, add the same server variables to the environments you use. Add the public number as
   `NEXT_PUBLIC_NAQAH_PHONE_NUMBER`, then redeploy so it is available to the Settings card.
5. Set `NAQAH_PUBLIC_BASE_URL` to the public origin Twilio calls if your proxy does not provide the correct first
   `x-forwarded-proto` and `x-forwarded-host` values. Otherwise the adapter uses those forwarded values, then falls
   back to the request URL. Signature validation also checks the URL with and without an explicit default port, using
   Twilio's [documented form request signing rules](https://www.twilio.com/docs/usage/webhooks/webhooks-security).

The webhook sequence is `POST /api/voice/inbound` → the relative `<Gather action>` at `POST /api/voice/turn` →
`POST /api/voice/status`. Call state is bound to Twilio's `CallSid` when present. Configure the number with call
forwarding/webhook behavior only; do not enable recording or transcription storage. Conversation state is signed, not
encrypted: answer text is readable in the action URL and can appear in request logs. The app does not store audio.

Twilio is the implemented voice-webhook adapter. Unifonic has its own [incoming-call API and IVR response format](https://unifonic.readme.io/reference/managing-your-incoming-calls),
so an Unifonic number needs a provider-specific adapter; it cannot call these Twilio routes directly with TwiML.
Confirm current number availability and local requirements directly with either provider before buying.

## Environment variables

| Variable | Purpose |
|---|---|
| `NAQAH_VOICE_SECRET` | HMAC-SHA256 key for signed stateless call state. Required for live voice. |
| `NAQAH_WORKER_PHONE` | Registered worker caller ID, preferably E.164. Required for live voice. |
| `NAQAH_OWNER_PHONE` | Owner caller ID: an owner calling in hears a short closed line. Required for owner call summaries. |
| `NAQAH_PUBLIC_BASE_URL` | Public origin Twilio signs; takes precedence over forwarded headers. |
| `NAQAH_ALLOW_UNSIGNED_VOICE` | Removed: no longer read. Local sample-line signature checks depend on whether `TWILIO_AUTH_TOKEN` is set. |
| `NAQAH_VOICE_LOCALE` | `ar` by default, or `en`. |
| `NAQAH_VOICE_ARABIC_VOICE` | Twilio `<Say>` voice override; defaults to `Polly.Zeina`. |
| `NAQAH_VOICE_ENGLISH_VOICE` | Twilio `<Say>` voice override; defaults to `Polly.Joanna`. |
| `TWILIO_AUTH_TOKEN` | Enables required Twilio signature checks. Invalid or missing signatures are rejected; required for production voice by default and for paid owner summaries. |
| `TWILIO_ACCOUNT_SID` | Twilio account SID for outbound owner calls. |
| `TWILIO_PHONE_NUMBER` | Twilio caller ID for outbound owner calls. |
| `NAQAH_CALL_OWNER` | Set to `1` to place the outbound owner call; defaults to off. |
| `NEXT_PUBLIC_NAQAH_PHONE_NUMBER` | Public number displayed as a `tel:` link in Settings. |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp Cloud API business phone-number ID. |
| `WHATSAPP_TOKEN` | WhatsApp Cloud API access token. |
| `NAQAH_OWNER_WHATSAPP` | Owner's WhatsApp recipient number with country code. |
| `WHATSAPP_TEMPLATE_NAME` | Optional approved WhatsApp template for business-initiated messages outside the 24-hour service window. |
| `WHATSAPP_TEMPLATE_LANGUAGE` | Template language code; defaults to `ar`. The approved template must accept one text body parameter. |

Template summaries are whitespace-normalized into a single line with ` • ` separators and capped at 1,000 characters;
plain-text summaries keep line breaks and are capped at 4,096 characters. The outbound spoken summary includes the
headline and findings only and is capped at 600 characters.

Copy `.env.example` to `.env.local` for local work. Never commit `.env.local` or provider tokens. For Vercel, use the
project's Environment Variables settings. Leave the optional WhatsApp and outbound-call variables unset to disable
those channels. Without `TWILIO_AUTH_TOKEN`, development and test calls may complete but never dispatch paid owner
summaries; the server logs `owner summary skipped: unsigned webhook` once when a worker report completes. Provider
failures are logged as non-sensitive outcome lines and do not fail the worker call. The Settings phone card shows
whether signature validation is enabled without exposing the token.

## WhatsApp Cloud API

Create and configure a WhatsApp Business Platform app and phone number in Meta's developer dashboard. Add
`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TOKEN`, and `NAQAH_OWNER_WHATSAPP`. Without `WHATSAPP_TEMPLATE_NAME`, the adapter
sends a text message; WhatsApp business-initiated messages outside the 24-hour customer-service window require an
approved template under [WhatsApp's business messaging policy](https://whatsappbusiness.com/policy/). To use one, set
its name and exact language code, and ensure its body contains one text variable for the full report summary. The
adapter places that summary in the first body parameter; see Meta's [template message request](https://www.postman.com/meta/whatsapp-business-platform/request/o65u5m5/send-message-template-text).

Twilio's current `<Gather>` language, speech, DTMF, and timeout behavior is described in its
[TwiML reference](https://www.twilio.com/docs/voice/twiml/gather). Supported recognition language and model
combinations may depend on the Twilio account and speech provider.

## Local verification without accounts

Unit tests use mocked network calls and need no Twilio or Meta account. The voice verifier completes a real report on
the configured server and can trigger paid summary channels, so use a local or test deployment unless those charges
are intended. By default it refuses to run when `WHATSAPP_TOKEN` or
`NAQAH_CALL_OWNER=1` is present in its environment; pass `--allow-paid` only when those effects are intended. For a
local route run with no paid settings, use:

```sh
NAQAH_VOICE_SECRET='a-random-test-secret-at-least-32-bytes' \
NAQAH_WORKER_PHONE='+966507782190' \
TWILIO_AUTH_TOKEN='local-test-auth-token' \
node scripts/verify-naqah.mjs launch
TWILIO_AUTH_TOKEN='local-test-auth-token' node scripts/verify-naqah.mjs voice --worker-phone '+966507782190'
node scripts/verify-naqah.mjs stop
```

Add `--locale en` to exercise English. The command posts a form-encoded inbound call, reads the signed Gather action,
answers each turn with scripted speech, and verifies the sample-call goodbye and tamper rejection. Each request and
response is kept in `artifacts/verify/voice/<timestamp>/` for review. Alternatively, while a server is running, POST
`From=<registered-worker-number>` to `/api/voice/inbound` with `Content-Type: application/x-www-form-urlencoded`, then
POST each `SpeechResult` to the `<Gather action>` URL returned by Twilio.

## Limits and next step

- The dialogue is the scripted engine in `src/domain/conversation/engine.ts`; speech is matched with normalized keywords,
  number words, and reply-label overlap. It is not an LLM and does not understand open-ended speech generally.
- Conversation state is signed, not encrypted, into the Gather action URL and expires after 30 minutes. Answers are
  therefore visible in URL and proxy request logs. The app replays the engine
  from a canonicalized sample workspace on every webhook. Nothing is stored: the sample report exists only to build
  the labelled summary. Farm mode does not use this state.
- Number and time extraction supports common Arabic and English forms, not every dialect or phrasing. The match is
  retried twice before an unknown choice is selected or the call ends.
- Caller ID identifies a configured worker or owner but can be spoofed by a caller. A valid Twilio signature proves
  the webhook came through Twilio; it does not prove that the caller ID belongs to the person calling.
- The owner match is checked before the worker match. If `NAQAH_OWNER_PHONE` is the same number as
  `NAQAH_WORKER_PHONE`, calls from that number hear the owner's closed line and the sample report is unreachable.
- WhatsApp provider policy, number eligibility, call pricing, and templates are controlled by Meta and Twilio and can
  change. Confirm current terms and charges with each provider before enabling a paid channel.
- Realtime speech through Twilio media streams exists for farm-mode report calls (`realtime-voice.md`). Keep the engine's
  domain transitions as tools, let the model phrase each turn, and save structured facts only after the domain action
  confirms success. Do not store recordings.
