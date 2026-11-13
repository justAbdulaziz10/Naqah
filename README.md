# NAQAH | ناقة

Private camel-ranch operations for one owner and one ranch. At the time the owner chooses, NAQAH calls the ranch
worker on an ordinary phone, asks the owner's questions one at a time and keeps only the facts (never audio). It then
calls the owner with what matters, and the owner follows the ranch on this website.

**Peace of mind, without the busyness. — اطمئنان، دون انشغال**

- **Live demo:** https://naqah.vercel.app (Arabic first; `/en` for English). Demo routes only: the sample ranch runs in
  the browser, every call there is a labelled simulation, and nothing is saved outside the visitor's browser.
- **Status:** investor MVP (November 2026). Real calling (Twilio, scripted or realtime voice), owner accounts
  (Supabase) and the AI Voice Lab are built but switched off in production; each needs its own flags, credentials and
  approval. Nothing is charged. Hosted Supabase does not yet have `20261113090000_report_call_scheduler` or
  `20261113100000_worker_call_claims`; see the [go-live checklist](docs/integrations/go-live-checklist.md).

## Stack

Next.js 16 (App Router, React 19), Tailwind CSS v4, zustand, Vitest and Playwright, deployed on Vercel. Supabase
(Postgres, Auth, RLS) for accounts and calls. Twilio Programmable Voice, with an optional Node bridge
(`services/voice-bridge`) to the OpenAI Realtime API for natural speech.

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000 → /ar
npm test             # domain rules, call engine, server routes (Vitest)
npm run typecheck
npm run lint
npm run build
```

The demo needs no environment variables. `.env.example` lists every variable the server, the bridge and the build
read, grouped by area; paid ones are marked.

## Where things are

Read **[`AGENT.md`](./AGENT.md)** first. It is the handbook: product rules, architecture, conventions, the
webhook map, migrations, open decisions and known pitfalls. `PRODUCT.md` holds the product brief.

## Docs

| Topic | Guide |
|---|---|
| Supabase schema, account mode, go-live list | [supabase-backend](docs/integrations/supabase-backend.md), [supabase-preparation](docs/integrations/supabase-preparation.md), [owner-auth](docs/integrations/owner-auth.md) |
| Phone line and activation | [phone](docs/integrations/phone.md), [twilio-activation](docs/integrations/twilio-activation.md), [call-schedule](docs/integrations/call-schedule.md), [owner-call-runs](docs/integrations/owner-call-runs.md) |
| Production calling go-live | [go-live-checklist](docs/integrations/go-live-checklist.md), [release runbook](docs/release/calling-v1.md) |
| Voice contract and realtime speech | [voice-data-contract](docs/integrations/voice-data-contract.md), [realtime-voice](docs/integrations/realtime-voice.md), [voice bridge](services/voice-bridge/README.md) |
| Testing calls | [test-calls](docs/integrations/test-calls.md), [voice-lab](docs/integrations/voice-lab.md), [backend-calling-verification](docs/integrations/backend-calling-verification.md) |
| Free integrations | [pwa](docs/integrations/pwa.md), [calendar](docs/integrations/calendar.md), [whatsapp-links](docs/integrations/whatsapp-links.md), [weather](docs/integrations/weather.md) |

## Contributing

Work on a branch from an up-to-date `origin/main`. Merging to `main` deploys production, so merges, deploys, live
migrations and paid calls need the owner's approval. This repository is public: never commit phone numbers, secrets
or project tokens.

A change is done when:

1. `npm test`, `npm run typecheck`, `npm run lint` and `npm run build` pass, with a test for every new rule.
2. UI changes are checked with `BASE=http://localhost:3000 node scripts/qa-screens.mjs` against
   `npm run build && npx next start` (not only `next dev`): Arabic and English, 375px and 1440px, no overflow or
   console errors.
3. Docs that describe the changed behaviour are updated in the same change.
