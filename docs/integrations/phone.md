# Phone line and report summaries

The phone adapter lets a registered worker call NAQAH, answer the scripted worker-report flow, and have the owner
receive the saved report summary through WhatsApp Cloud API, an outbound Twilio call, or both. It appears in the
owner's **Settings → Connections** section. With no voice configuration, that card says the line is not connected and
that Call Lab simulates calls.

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
   and `NEXT_PUBLIC_NAQAH_PHONE_NUMBER` to the purchased number. Optionally set `NAQAH_OWNER_PHONE` to let the owner
   call in for an inquiry. Set `TWILIO_AUTH_TOKEN` to enable signature validation for every inbound/turn webhook.
4. In Vercel project settings, add the same server variables to the environments you use. Add the public number as
   `NEXT_PUBLIC_NAQAH_PHONE_NUMBER`, then redeploy so it is available to the Settings card.
5. Keep the configured webhook host and scheme consistent with the public URL Twilio signs. If a proxy rewrites the
   webhook URL, configure it to preserve the original public URL and query string. The adapter validates
   `X-Twilio-Signature` using the [documented form request signing rules](https://www.twilio.com/docs/usage/webhooks/webhooks-security).

The webhook sequence is `POST /api/voice/inbound` → the signed `action` URL in its `<Gather>` at
`POST /api/voice/turn` → `POST /api/voice/status`. Configure the number with call forwarding/webhook behavior only; do
not enable recording or transcription storage. The app stores answer text as part of signed state while a call is in
progress, but it does not store audio.

Twilio is the implemented voice-webhook adapter. Unifonic has its own [incoming-call API and IVR response format](https://unifonic.readme.io/reference/managing-your-incoming-calls),
so an Unifonic number needs a provider-specific adapter; it cannot call these Twilio routes directly with TwiML.
Confirm current number availability and local requirements directly with either provider before buying.

## Environment variables

| Variable | Purpose |
|---|---|
| `NAQAH_VOICE_SECRET` | HMAC-SHA256 key for signed stateless call state. Required for live voice. |
| `NAQAH_WORKER_PHONE` | Registered worker caller ID, preferably E.164. Required for live voice. |
| `NAQAH_OWNER_PHONE` | Owner caller ID; enables owner inquiry matching and is required for owner call summaries. |
| `NAQAH_VOICE_LOCALE` | `ar` by default, or `en`. |
| `NAQAH_VOICE_ARABIC_VOICE` | Twilio `<Say>` voice override; defaults to `Polly.Zeina`. |
| `NAQAH_VOICE_ENGLISH_VOICE` | Twilio `<Say>` voice override; defaults to `Polly.Joanna`. |
| `TWILIO_AUTH_TOKEN` | Optional webhook signature validation. If set, unsigned or invalid webhooks are rejected. |
| `TWILIO_ACCOUNT_SID` | Twilio account SID for outbound owner calls. |
| `TWILIO_PHONE_NUMBER` | Twilio caller ID for outbound owner calls. |
| `NAQAH_CALL_OWNER` | Set to `1` to place the outbound owner call; defaults to off. |
| `NEXT_PUBLIC_NAQAH_PHONE_NUMBER` | Public number displayed as a `tel:` link in Settings. |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp Cloud API business phone-number ID. |
| `WHATSAPP_TOKEN` | WhatsApp Cloud API access token. |
| `NAQAH_OWNER_WHATSAPP` | Owner's WhatsApp recipient number with country code. |
| `WHATSAPP_TEMPLATE_NAME` | Optional approved WhatsApp template for business-initiated messages outside the 24-hour service window. |
| `WHATSAPP_TEMPLATE_LANGUAGE` | Template language code; defaults to `ar`. The approved template must accept one text body parameter. |

Copy `.env.example` to `.env.local` for local work. Never commit `.env.local` or provider tokens. For Vercel, use the
project's Environment Variables settings. Leave the optional WhatsApp and outbound-call variables unset to disable
those channels. Provider requests are made only when credentials and recipients are present; failures are logged as
non-sensitive outcome lines and do not fail the worker call.

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

Unit tests use mocked network calls and need no Twilio or Meta account. For a live local route simulation, run:

```sh
NAQAH_VOICE_SECRET='a-random-test-secret-at-least-32-bytes' \
NAQAH_WORKER_PHONE='+966507782190' \
node scripts/verify-naqah.mjs launch
node scripts/verify-naqah.mjs voice --worker-phone '+966507782190'
node scripts/verify-naqah.mjs stop
```

Add `--locale en` to exercise English. The command posts a form-encoded inbound call, reads the signed Gather action,
answers each turn with scripted speech, and verifies a saved-report goodbye and tamper rejection. Each request and
response is kept in `artifacts/verify/voice/<timestamp>/` for review. Alternatively, while a server is running, POST
`From=<registered-worker-number>` to `/api/voice/inbound` with `Content-Type: application/x-www-form-urlencoded`, then
POST each `SpeechResult` to the `<Gather action>` URL returned by Twilio.

## Limits and next step

- The dialogue is the scripted engine in `src/domain/conversation/engine.ts`; speech is matched with normalized keywords,
  number words, and reply-label overlap. It is not an LLM and does not understand open-ended speech generally.
- Conversation state is signed into the Gather action URL and expires after 30 minutes. The app replays the engine
  from a canonicalized sample workspace on every webhook. There is no server database, so the saved report is only
  available to build and send the immediate summary; it does not appear in the owner's dashboard yet.
- Number and time extraction supports common Arabic and English forms, not every dialect or phrasing. The match is
  retried twice before an unknown choice is selected or the call ends.
- WhatsApp provider policy, number eligibility, call pricing, and templates are controlled by Meta and Twilio and can
  change. Confirm current terms and charges with each provider before enabling a paid channel.
- The later production path is Supabase persistence plus a realtime speech model connected through Twilio media
  streams (or provider SIP). Keep the engine's domain transitions as tools, let the realtime model phrase each turn,
  and save structured facts only after the domain action confirms success. Do not store recordings.
