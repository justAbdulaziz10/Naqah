# Twilio activation: one authorized test call

Status: code and local tests only. **No number is bought, no webhook is set, no migration is
applied, and nothing is deployed.** Every step below needs the owner's approval first.

Milestone: worker calls → answers configured questions → structured report saves to Supabase →
owner sees it on the dashboard. All of it is built and passes locally with Twilio and Auth mocked.

## How a real call works

`NAQAH_VOICE_MODE=farm` turns on the path below. Unset, the line runs the sample farm, says so to
the caller, and saves nothing. Farm mode never falls back to sample data: if a required variable
is missing, the caller hears that the line isn't configured.

1. Twilio posts to `/api/voice/inbound`. The signature must verify; `NAQAH_ALLOW_UNSIGNED_VOICE`
   has no effect here.
2. `findCaller` matches the number to one farm. Unknown, hidden, or ambiguous numbers hear a
   refusal and nothing is written. So does a farm with `setup_complete = false` or a missing
   worker or owner name.
3. The scripted engine runs on the farm loaded from Supabase. `voice_call_sessions` holds the
   call's position, so the questions stay fixed for the call and answers stay out of URLs.
4. On confirmation, `applyVoiceEvent` runs the rules on fresh state and saves in one transaction.
   The caller hears "saved" only after that returns `saved`.
5. A failed save is never reported as saved. The caller gets one retry, then is told it couldn't
   be confirmed. A repeated webhook gets its first reply and saves nothing twice.
6. `/api/voice/status` deletes the working row when the call ends. A hang-up saves nothing.

It is scripted, not conversational AI: `src/domain/conversation/engine.ts` asks fixed questions and
`src/server/voice/speech.ts` matches keywords. No model is called and nothing is billed for one.

## Blocked

These stop the first real call. None can be worked around with sample data.

| Dependency | Why | Owner |
|---|---|---|
| Access to `ydsgmzxqjimwbamnksxe` | The connected Supabase account lists one other project, and the REST API returns 404 for `farms`, so the migrations are not applied. | Project owner |
| `SUPABASE_SECRET_KEY` | Not in `.env.local`, which still has the empty legacy name. | Project owner |
| Twilio credentials | None on this machine, and no Twilio tool is connected, so the account could not be checked. | Project owner |

Decisions needed from the owner:

- **Owner notification.** Not sent in farm mode. The existing summary goes to one number from the
  environment, which would send one farm's report to the wrong person, and nothing records whether
  the owner answered. It needs an outbound call that uses `farms.owner_phone` and a status webhook
  that sends `owner_notification`.
- **Owner inquiry.** Built and tested, off by default (`NAQAH_VOICE_OWNER_INQUIRY`). Caller ID can
  be spoofed and an inquiry reads farm data aloud. Decide whether a PIN is needed first.
- **A worker number on two farms** is refused for both. That is deliberate (open decision 4).

## Expected cost

Read from Twilio's pages on 2026-11-06. Confirm before buying.

| Item | Price | One 5-minute call |
|---|---|---|
| US local number | $1.15 a month | $1.15 |
| Inbound call | $0.0085 a minute | $0.04 |
| Speech recognition, about 12 answers | $0.02 per use | $0.24 |
| `<Say>` with Polly | Billing tier unconfirmed; Standard is listed at $0.0008 per 100 characters | about $0.02 |
| **Twilio total** | | **about $1.45** |
| Caller's carrier charge, Saudi mobile to a US number | Not published by Twilio | Check with the carrier |

No owner call or WhatsApp message is sent in farm mode.

Sources: [US pricing](https://www.twilio.com/en-us/voice/pricing/us),
[voice pricing](https://www.twilio.com/en-us/voice/pricing),
[Saudi pricing](https://www.twilio.com/en-us/voice/pricing/sa).

**A Saudi number is not the fast path.** Twilio's [Saudi guidelines](https://www.twilio.com/en-us/guidelines/sa/regulatory)
list toll-free +966800 numbers only, with a business registration or ID and a signed Letter of
Authorization. The lead time isn't stated. Use a US number for the first test.

**Use an upgraded account.** Twilio says trial calls are [restricted to the sign-up country](https://www.twilio.com/docs/usage/tutorials/how-to-use-your-free-trial-account),
so a call from Saudi may not connect, and a trial plays its own message first.

## Steps for one test call

Each step is the owner's to approve.

1. **Confirm the project.** Check that you can open `ydsgmzxqjimwbamnksxe`. Never apply this
   schema to any other project.
2. **Apply the schema.** Follow `supabase-preparation.md`. The dry run must list exactly `0001`,
   `0002` and `0003`. Then run Security and Performance Advisors.
3. **Get a public HTTPS address.** Either run the branch locally behind a tunnel, which needs no
   deployment, or use a deployment without Vercel Authentication. Twilio can't pass that login.
4. **Set the server variables** there, never in a `NEXT_PUBLIC_` name:

   ```sh
   NAQAH_VOICE_MODE=farm
   NEXT_PUBLIC_NAQAH_ACCOUNT_DATA=1      # build-time: rebuild after setting it
   NAQAH_PUBLIC_BASE_URL=https://<exact public origin>
   TWILIO_AUTH_TOKEN=<primary auth token>
   SUPABASE_SECRET_KEY=<sb_secret_...>
   NEXT_PUBLIC_SUPABASE_URL=https://ydsgmzxqjimwbamnksxe.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<sb_publishable_...>
   ```

   Leave `NAQAH_CALL_OWNER`, `WHATSAPP_TOKEN` and `NAQAH_VOICE_OWNER_INQUIRY` unset.
5. **Check it refuses strangers.** An unsigned post must return 403:

   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<origin>/api/voice/inbound -d 'From=%2B15550100'
   ```

6. **Create the test farm.** Sign in on the site and finish setup with
   the test phone as the worker. Use a different phone for the owner. It stays on Basic, so set a
   reporting window that covers the call, in Settings.

7. **Buy the number and point it here.** Upgrade the account, buy a US voice number, then under
   Voice Configuration set **A call comes in** to `https://<origin>/api/voice/inbound` and
   **Call status changes** to `https://<origin>/api/voice/status`, both HTTP POST. Leave recording
   off. Confirm the status field in the console; the pages read for this guide only describe
   status callbacks on `<Number>`, not on the phone number itself.
8. **Make the call** from the test phone. Expect the automated-assistant greeting, then the
   farm's questions. Answer by voice for at least two questions, to test Arabic recognition.
   Press 1 at the summary.
9. **Check the database.** The report must be there, with the right call:

   ```sql
   select r.at, c.provider_call_id, a.question_ar, a.answer, a.certainty
   from reports r
   join calls c on c.id = r.call_id
   join report_answers a on a.report_id = r.id
   order by r.at desc, a.sort_order;

   select count(*) from voice_call_sessions; -- 0 once the call has ended
   ```

10. **Check Twilio's call log** for webhook errors and confirm no recording exists.

11. **Check the dashboard.** Signed in as the owner, open Calls. The report must be there.

Pass: the call completes, one report matches what was said, the working row is gone, the Twilio log
is clean, and the owner sees the report.

Rollback: clear the number's webhook URLs, or unset `NAQAH_VOICE_MODE`. Then release the number to
stop the monthly charge. Test rows go with `delete from farms where id = '<id>'`, which removes
that farm's history.

## Known limits

- **Arabic speech recognition is untested on real audio.** It is the largest unknown. Twilio lists
  `ar-*` for its experimental models only, and `<Gather>` sets no `speechModel` today. Choices can
  fall back to the keypad; free-text answers can't.
- **Replies read in full.** A herd above nine camels can't be picked by keypad, and "all well"
  lists each camel in the summary. Fine for a test farm, not for a large herd.
- **Worker languages.** Arabic and English only. The other languages setup offers are spoken to
  in Arabic.
- **Sample names.** Engine copy still swaps sample names at render, so free text containing
  «أحمد» or "Abdullah" is swapped too, for example a task about another person with that name.
  Pass names into the engine to fix this.
- **Working rows.** If a call's final status callback is lost, the row and any partial draft stay
  until the next inbound call clears them. The row is service-only. Run the cleanup from the
  scheduler once one exists.
- **Quantity units.** Stored and spoken in English even on an Arabic call: «العلف: كافٍ (12 bags)».
- **Heat-day question.** Weather isn't stored on the server, so real calls don't ask it.
- **Retries and tasks.** The scheduler for 20-minute retries and task verification calls isn't
  built, so those outbound calls don't happen yet. Outcomes from worker-initiated calls do save.
- **Caller ID is not proof.** A valid signature shows the request came through Twilio, not who is
  calling. A spoofed worker number could file that farm's report.

- **Phone numbers aren't verified.** See `supabase-backend.md`. Keep sign-up closed until decided.

## Testing it locally

No Twilio or Supabase account needed. Needs a throwaway Postgres over TCP and a PostgREST binary:

```sh
PGHOST=127.0.0.1 PGPORT=<port> PGUSER=postgres POSTGREST_BIN=<path> sh supabase/local-validation/run-voice.sh
```

Signed webhooks enter the real route handlers, then real `supabase-js`, PostgREST and all
migrations. Only Twilio is mocked. `npm test` covers the signature, routing and speech rules without
a database.
