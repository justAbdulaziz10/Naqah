# AI Voice Lab

A private page at `/[locale]/app/voice-lab` for testing the real report agent in a browser, with no phone call.
Off unless `NAQAH_VOICE_LAB=1`.

## What is real and what is not

| Part | In the Lab |
|---|---|
| Model and voice | Same: `REALTIME_MODEL` from `services/voice-bridge/config.mjs`, voice `marin` |
| Instructions, tool schemas, tool checks | Same code: `realtime/instructions.ts`, `realtime/tools.ts` |
| Conversation state | Same engine: `start` / `answer` |
| Report validation | Same code: `parseVoiceEvent`, `eventAllowed`, `voiceStep` |
| VAD settings | Same values |
| Turn rules | **Ported** to `src/components/voice-lab/turnLoop.ts` from the bridge's `CallStream` |
| Audio | Different: browser Opus over WebRTC, not 8 kHz G.711 from a phone |
| Saving | None. `voiceStep`'s resulting workspace is discarded |

## Safety

- **No write path.** `src/server/voice-lab/agent.ts` takes no database client. The ranch is read with the owner's own
  session and RLS. `agent.test.ts` fails if Lab code references a service client, the writable client, `applyVoiceEvent`,
  `farm-call`, `server/calls`, Twilio or a Supabase write call.
- **A confirmed report is judged, not stored.** The agent is told `saved` so its closing behaviour can be tested. The
  page states the verdict and that nothing was saved.
- **Report call only.** The workspace copy holds a synthetic answered run and no reports, so it works at any hour.
- **Access.** `NAQAH_VOICE_LAB=1`, a validated Supabase session (`getOwner`), and a listing in `NAQAH_VOICE_LAB_OWNERS`.
  An unlisted owner gets 404, because every session spends OpenAI credit. Same-origin POST only.
- **Key.** `OPENAI_API_KEY` stays on the server. The browser posts its SDP to `/api/voice-lab`; the server adds the
  session config and forwards it. No ephemeral key reaches the browser.
- **No storage.** Transcripts exist only in React state and go away on reset or leaving the page.

## Session state

No database row. The position in the call is a token signed with HMAC-SHA256 under a key derived from
`NAQAH_VOICE_SECRET` and `"naqah-voice-lab"`. It is bound to the owner and the OpenAI call id and lasts 30 minutes. Each
turn reloads the ranch.

## API: `POST /api/voice-lab`

| `op` | Body | Returns |
|---|---|---|
| `status` | `locale` | `model`, `configured`, `source`, `ranch`, `worker`, `queue` |
| `open` | `mode` (`voice`/`text`), `locale`, `sdp` | `answer`, `state`, `opening`, `view`, `source`, `model`, `pricing`, `maxSeconds` |
| `tool` | `state`, `name`, `args`, `spoke` | `output`, `awaitingConfirmation`, `end`, `goodbye`, `refused`, `view`, `state` |
| `close` | `state` | Hangs up the OpenAI call |

## Environment

| Variable | Notes |
|---|---|
| `NAQAH_VOICE_LAB` | `1` to enable. Server side |
| `NAQAH_VOICE_LAB_OWNERS` | Comma-separated emails or user ids. Empty allows nobody |
| `NEXT_PUBLIC_NAQAH_VOICE_LAB` | `1` shows the nav link. Only cosmetic |
| `OPENAI_API_KEY`, `NAQAH_VOICE_SECRET` | Already used by the calling code |

The Lab needs no Twilio, cron or `SUPABASE_SECRET_KEY` variable.

## Contract with the calling team

The Lab imports these and needs their signatures kept:

- `realtime/tools`: `REALTIME_TOOLS`, `checkTool(name, args, spoke, session, locale)`, `promptFor(session, spoken, ws, locale)`, `SUMMARY_STEP`
- `realtime/instructions`: `buildInstructions(locale, names, current)`
- `contract`: `parseVoiceEvent`, `eventAllowed`, `voiceStep`
- `twiml`: `spokenWording`
- `services/voice-bridge/config.mjs`: `REALTIME_MODEL`
- engine: `start`, `answer`

## Confirmation

The Lab calls the calling team's `isVerifiedConfirmation` (`realtime/confirmation.ts`), and their engine fixes for Saudi
quantities and Arabic herd answers run unchanged. The Lab follows the rest of their confirmation flow:

- `confirm_report` with `confirmed: true` needs the worker's latest final transcript.
- Only a summary spoken word for word from `summaryText` counts as heard, and it must play or display to the end. An
  interrupted one is refused with `summary_not_finished` and read again.
- The second failed confirmation ends the test with a `fallback` verdict. A real call moves to the keypad script.

`turnLoop.ts` still mirrors the bridge's `heardSummary`, turn staleness, 2.5 s transcript wait and 10 s speech recovery,
tracked per response. `agent.test.ts` fails if those limits drift.

## Known differences from a real call

| Behaviour | Lab | Real call |
|---|---|---|
| Audio | Browser Opus over WebRTC | 8 kHz G.711 through Twilio |
| "Summary heard" | `output_audio_buffer.stopped` for that response | Twilio playback marks |
| Failure of the AI stream | Test stops | Continues on the keypad script |
| Word check on ordinary answers (`number_not_in_answer`, `answer_conflicts_with_words`) | Keeps asking when a final transcript is ready | No check |
| Typing during a voice test | Counts as a final transcript | Not possible |
| A report already saved this period | Ignored, so any ranch can be tested | Refused as `daily_done` / `weekly_done` |
| Saving | Verdict only | Writes through `applyVoiceEvent` |

The dashboard around this page is ordinary: opening it creates default ranch rows for an owner who has none, and other
sidebar pages save real data.

## Requests to the calling team

None of these block the Lab:

1. Move `CallStream`'s turn rules into a transport-free module that the Lab can import in place of `turnLoop.ts`.
2. Move `wireDraft`, `eventFor` and the closing lines (`SAVED`, `ENDED`) out of `farm-call.ts` and `service.ts` into a
   module with no I/O. The Lab copies them because importing `farm-call.ts` would bring in the Twilio and write paths.
3. If the bridge's `session.update` changes (VAD, voice, model parameters), export it so `labSession` can use it.
