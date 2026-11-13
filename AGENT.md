# NAQAH | ناقة — Project Handbook (AGENT.md)

> **Read this first.** It is the single source of truth for humans and AI agents working on this repo:
> what the product is, which rules are confirmed, how the code is organized, and what is still open.

**Status:** Investor MVP / demo (November 2026). Nothing is charged. The demo runs in the browser. Real calling
(Twilio, scripted or realtime), account persistence and the Voice Lab exist behind opt-in flags; their code being
present does not mean the live project has been migrated or activated.

**Current state** (check before trusting it):
- Canonical branch: `origin/main`. Always `git fetch` and compare with `origin/main` before auditing or branching.
- Production is https://naqah.vercel.app: demo only. Calling, account mode and the Voice Lab are off unless their
  flags are set there.
- Hosted Supabase has migrations through `20261110090000_mvp_owner_runs.sql` applied (team notes, 2026-11-11).
  `20261113090000_report_call_scheduler.sql` and `20261113100000_worker_call_claims.sql` are **not** applied.
- The repository is **public**: never commit real phone numbers, secrets or project-specific tokens.
- Needs the owner's explicit approval: merging to `main`, deploying, live migrations, paid calls.

---

## 1. Product in one paragraph

NAQAH is private camel-ranch operations management for **one owner, one farm**, with up to 3 registered workers (Basic)
or 10 (Ultimate). At the time the owner chooses, **NAQAH calls the primary worker** on an ordinary phone (no app); the AI
voice agent asks the owner-configured questions, records structured facts (never audio), and updates the farm. At the owner's own scheduled time the AI **calls the owner** with only what matters from the latest verified report (or says plainly that none arrived).
The **owner** uses a website (this app) to set up the farm, see the latest state, and track tickets.
Brand promise: **Peace of Mind — «اطمئنان، دون انشغال»**. Personality: *The Quiet Steward*.

## 2. Confirmed rules (from the MVP workflow diagrams Phases 1–10)

| Area | Basic | Ultimate |
|---|---|---|
| Custom questions (owner-written) | up to **5** | unlimited |
| Predefined questions (NAQAH team) | the owner can switch any question off, reorder it or make it optional; skipped if the resource is absent. At least one enabled question or follow-up task is required | same |
| How the report is taken | owner chooses: worker chooses, guided only, or open only. Open and worker-choice need a realtime call; a scripted call is always guided | same |
| Report call (NAQAH → primary worker) | **one per week**, on the weekday and exact time the owner sets (Asia/Riyadh) | **one per day**, at the exact time the owner sets |
| Report call not completed | unanswered or interrupted (including a worker ending without saving) uses an attempt: **3 attempts total, 20 min apart**, then the run is *missed*. A saved report stops the retries. "Call now" stays one attempt; the worker may call back that period to report | same |
| Registered workers / herd | up to **3** workers; the owner keeps the official herd count, a worker's count is a proposal | up to **10** workers; same |
| Owner calls the AI | **not available**: NAQAH always places the call | same |
| Owner summary call | weekly, at the owner's own day and time, always placed even when no verified report exists (the owner is told so). **3 attempts total, 20 min apart**; interrupted counts. Summary, then the call ends. No instructions, no tickets | daily, at the owner's own time; same retries. Summary, then spoken instructions: AI proposes task or information, and the owner can add, remove or correct items during the read-back. The complete list is read again and nothing saves without an explicit yes. Tasks create tickets, information does not, one worker call |
| Task tickets | — | close **only** when the worker explicitly confirms; deadlines never close them; closed → History |
| Task verification | — | scheduled time → AI calls the worker; "any time" → asked during later worker interactions |
| Worker instruction or verification call | Ultimate only | **3 attempts total**, 20 min apart; interrupted counts; delivered only after explicit receipt or explicit answers. No No Answer Ticket. After three failures the batch shows as *Not delivered* and the owner can try again; the same call is requeued, so nothing is duplicated |
| Worker returns missed call | always answered (even outside the window); delivers missed messages; closes a **historical** No Answer Ticket if one is still open. No new ticket is created. **Not** a farm update and does not consume the report | same |
| Emergency | worker calls the owner **directly** — never through the AI | same |

Agent behavior (from `NAQAH_AI_Agent_Identity_DRAFT_v0.1`): identifies itself as automated; one question at a time;
accepts «ما أدري» / "I don't know"; confirms quantities and camel names; never diagnoses; never claims
"saved/notified/created" before the system confirms; a thanks such as «الله يعطيك العافية» alone is never a save confirmation (only an explicit yes to the read-back is); labels facts as *reported / approximate / unknown / verified*;
never presents old data as new; stores extracted facts only (**no recordings**).

**Report modes (Nov 2026).** *Guided* asks the owner's enabled questions in order, one at a time. *Open* lets the worker say what happened; facts land in their topics and anything unmentioned is saved as **not reported**, never healthy or unchanged, and is not asked about. Due tasks are still asked after an open update, because a task closes only on an explicit yes. Both modes read back every recorded detail, allow corrections, and save one report only after an explicit yes to the summary the worker actually heard. The model listens and classifies; the server chooses every spoken word. Calls stay short: one question at a time, options read aloud only on the keypad or after an answer was not understood, and no per-item confirmations, because the final read-back confirms everything. Words about another topic are kept as a note and read back, never dropped. Task verifications due at the same time share one worker call.

The old Basic From/To *reporting window* (worker calls in) is **retired** (Nov 2026): columns remain only so old rows load.

**Do not add** (not approved): native apps, a website chatbot, multiple farms, diagnosis, purchasing,
extra reporting updates, new channels, automated emergency dispatch.

## 3. Architecture

```
Next.js 16 (App Router, React 19, Tailwind v4)  →  deployed on Vercel (free Hobby plan)
└─ src/
   ├─ app/[locale]/…            routes; locale ∈ {ar, en}; Arabic is default and RTL
   │   ├─ page.tsx              landing page
   │   ├─ start/                owner onboarding wizard (Phase 1)
   │   └─ app/                  owner dashboard (overview, herd, tickets, calls, settings, lab)
   ├─ proxy.ts                  redirects "/" → "/ar" or "/en" (cookie → Accept-Language)
   ├─ domain/                   PURE business logic — no React, no storage
   │   ├─ types.ts              the Workspace model (one owner/farm/worker)
   │   ├─ catalog.ts            predefined questions (DRAFT wording), labels, plan limits
   │   ├─ clock.ts              Asia/Riyadh time, weekly window, retry constants
   │   ├─ rules.ts              gating: who may call when, applicable questions, due retries
   │   ├─ findings.ts           important-findings evaluation + owner briefing text
   │   ├─ actions.ts            state transitions (complete report, open ticket, retry, callback…)
   │   ├─ reportCalls.ts        report-call runs: claim the due slot, attempts, retries, missed
   │   ├─ ownerCalls.ts         owner summary-call runs: claim, attempts, retries
   │   ├─ seed.ts               empty workspace + sample demo farm
   │   ├─ rules.test.ts         Vitest coverage of every rule above
   │   └─ conversation/         scripted call engine (start/answer → session + commit); the reference for real calls
   │       ├─ engine.ts         every call type: worker report, owner briefing, NAQAH→worker + retries,
   │       │                    worker callback, owner inquiry, emergency info
   │       └─ personalize.ts    swaps the sample names (Ahmed/Abdullah) for the farm's real ones at render
   ├─ app/api/                  route handlers: voice webhooks, cron, call-now, account, test calls (see §8.4)
   ├─ server/db/                Supabase persistence, wired to account-mode UI behind its flag: row mappers, change diff,
   │                            owner repository (RLS session) and service repository (see §8.1)
   ├─ server/farm/              owner Server Actions (incl. "Call now") and input validation
   ├─ server/calls/             outbound placement (Twilio REST), the scheduler behind the cron route, signed call
   │                            tokens, allowlist, call-length cap and call-now limits, manual test calls
   ├─ server/voice/             contract.ts (voice → farm data), farm-call.ts (real farm calls), preflight.ts (free
   │                            checks before dialling), realtime/* (tools, decisions and state for the realtime model)
   ├─ server/voice-lab/         AI Voice Lab: browser session with the realtime model, saves nothing
   ├─ store/workspace.ts        zustand store persisted to localStorage (`naqah-workspace-v1`)
   ├─ i18n/                     config, formatting (Riyadh time, Latin digits), messages per slice
   ├─ components/ui/            design-system primitives (Button, Card, Badge, Field, Switch, Segmented)
   ├─ components/brand/         CamelMark (approved logo, traced 1:1) and Logo lockup
   ├─ components/shell/         AppShell (dashboard nav), LocaleSwitcher, DemoClock
   ├─ components/landing/       public landing page sections
   ├─ components/setup/         onboarding wizard + settings sections (shared)
   ├─ components/dashboard/     estate header, matters, ledger and other overview/herd/tickets/calls building blocks
   └─ components/lab/           Call Lab UI (phone stage, "Inside NAQAH" panel, demo clock)
services/voice-bridge/          plain Node service: Twilio media stream ↔ OpenAI Realtime, tool calls go back to
                                /api/voice/realtime/*; runs outside Vercel (see its README)
supabase/migrations/            production schema (not used by the demo) — see §8.1
```

### Data flow
UI → `useWorkspaceStore().update(ws => someAction(ws, now, …).ws)` → the pure function returns a new workspace →
zustand persists it. **All business rules live in `src/domain`.** Never re-implement a rule inside a component.

### The demo clock
`workspace.clockOffsetMs` lets the investor jump time (e.g. +20 minutes for a retry, or to Thursday 17:00 for a Basic
window). Always get "now" with `useNow()` (client) or `nowFor(ws)` — never `new Date()` for business decisions.

## 4. Conventions

- **Bilingual always.** Every visible string lives in `src/i18n/messages/<slice>.ts` with identical `en` and `ar` keys
  (`defineMessages` enforces this at compile time). Use `const { m, t, fmt, href } = useI18n()`.
  Stored user-facing text from the domain is `LocalizedText {ar, en}` → render with `t(text)`.
- **RTL first.** Use logical utilities only: `ms-/me-/ps-/pe-/start-/end-/text-start`, never `ml/mr/left/right`.
  Mirror directional icons in RTL (`rtl:-scale-x-100`). Phone numbers, tags and times: wrap in `.ltr-nums`.
- **Numbers** render in Latin digits in both languages (brand: Montserrat renders numbers).
- **Fonts:** Montserrat (Latin) + Alexandria (Arabic) via `next/font`; the stack lets each script use its own font.
- **Colors:** use tokens from `globals.css` (`bg-ivory`, `bg-cream`, `text-espresso`, `bg-brown`, `text-gold`,
  `border-stone`, status `ok/warn/danger/info` + `-soft`). Gold is decorative or large text only (contrast).
- **Icons:** Phosphor (`@phosphor-icons/react`; in Server Components import from `@phosphor-icons/react/dist/ssr`).
  The camel logo is **not** an icon — use `<CamelMark/>`, never redraw/outline/distort it.
- **Copy:** quiet, warm, direct («Warm Discretion»). No hype, no exclamation marks, no emoji. Contemporary Saudi Arabic,
  not stiff MSA. Cut helper text a layout doesn't need. The ranch is «عزبة» in Arabic and "ranch" in English, everywhere.
- **Accessibility:** 44px touch targets, visible focus, labels on every control, `prefers-reduced-motion` respected.
- **Client vs server:** pages that read the workspace are client components (`"use client"`); the landing page can
  be a server component with client islands.

## 5. Running

```bash
npm install
npm run dev        # http://localhost:3000 → redirects to /ar
npm test           # domain rules (Vitest)
npm run typecheck && npm run lint && npm run build
```

## 5a. Integrations (Settings → Connections)

Production calling go-live: `docs/integrations/go-live-checklist.md`.

Each integration has its own guide in `docs/integrations/`. Free ones work today; paid ones are fully coded but
stay off until their env vars are set (see `.env.example`). Nothing here needs a paid account for the demo.

| Integration | Cost | Where it shows | Code | Guide |
|---|---|---|---|---|
| Installable app, offline, notifications | Free | Settings card; app-wide | `src/app/manifest.ts`, `public/sw.js`, `src/components/pwa/`, `src/app/api/push` | `pwa.md` |
| Calendar feed + per-task "add to calendar" | Free | Settings card; Tickets rows | `src/lib/calendar/`, `src/app/api/calendar` | `calendar.md` |
| WhatsApp deep links (message worker, order from supplier) | Free | Settings card; dashboard resources + emergency | `src/lib/whatsapp/`, `WhatsAppActions.tsx` | `whatsapp-links.md` |
| Weather + farm location + heat-day question | Free (Open-Meteo) | Dashboard line; Settings card; setup; Call Lab "Simulate a heat day" | `src/domain/weather.ts`, `src/lib/weather/`, `src/lib/geo/` | `weather.md` |
| Real phone line (Twilio) + WhatsApp Cloud summary | **Paid** per minute / message | Settings "Phone line" card; dashboard "Call now" | `src/server/calls`, `src/server/voice`, `src/app/api/voice/*`, `src/app/api/cron/report-calls` | `phone.md`, `twilio-activation.md`, `call-schedule.md` |
| Realtime voice (natural speech on report calls) | **Paid** (OpenAI Realtime + Twilio) | The worker's report call | `services/voice-bridge`, `src/server/voice/realtime`, `src/app/api/voice/realtime/*`; on with `NAQAH_VOICE_MODE=farm` + `NAQAH_VOICE_ENGINE=realtime` + a valid `NAQAH_BRIDGE_PUBLIC_URL` | `realtime-voice.md` |
| AI Voice Lab (talk to the report agent in the browser, saves nothing) | **Paid** (OpenAI) | `/app/voice-lab`, account mode only | `src/server/voice-lab`, `src/app/api/voice-lab`; `NAQAH_VOICE_LAB=1`, listed `NAQAH_VOICE_LAB_OWNERS`, nav link `NEXT_PUBLIC_NAQAH_VOICE_LAB=1` | `voice-lab.md` |
| Manual test call (admin only) | **Paid** | Call Lab (`/app/lab`) in account mode; nav link `NEXT_PUBLIC_NAQAH_TEST_CALL=1` | `src/server/calls/test-call*.ts`, `src/app/api/test-call`; `NAQAH_TEST_CALLS=1`, `NAQAH_TEST_CALL_ADMINS` | `test-calls.md` |

Things to know before changing them:
- **Two phone modes.** By default the line is the *sample* line: signed `s` state, each turn replays the engine on the
  sample workspace, it says it is a sample, and it saves nothing. `NAQAH_VOICE_MODE=farm` is a real call: the caller
  resolves to a farm in Supabase, `voice_call_sessions` holds the call, and outcomes save through `applyVoiceEvent`.
  Farm mode never falls back to sample data. See `twilio-activation.md`.
- **Two data modes.** Only with the exact build-time value `NEXT_PUBLIC_NAQAH_ACCOUNT_DATA=1`, a signed-in owner's farm comes from Supabase through
  `src/store/accountSync.ts`; everyone else keeps the localStorage demo. `update(fn)` works in both, but only
  owner-writable fields reach the database. The server also gates `/api/account` (404 when disabled) and every owner
  Server Action (unavailable without repository access). Anything demo-only must check `useIsAccount()`.
  Unsetting the flag requires a rebuild/deployment and does not revoke direct Supabase access or stop voice writes.
  See `supabase-backend.md`.
- **Voice locale is per deployment** (`NAQAH_VOICE_LOCALE`). Verify with
  `node scripts/verify-naqah.mjs voice --locale <same locale as the server>`.
- **Push:** without VAPID keys, notifications are shown locally by the service worker while the app is open.
  Server push needs `NEXT_PUBLIC_VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` (`npx web-push generate-vapid-keys`).
- **Calendar links are snapshots.** The subscription URL encodes the schedule when it is copied; re-add after changes.
- **Proxy matcher** (`src/proxy.ts`) must exclude every non-locale route: `api`, `icon`, `apple-icon`,
  `pwa-icons`, and anything with a dot (`manifest.webmanifest`, `sw.js`). A new metadata route without a dot
  will otherwise be redirected to `/ar/...`.
- The heat-day finding is passed through `ReportDraft.extraFindings`, so it is counted by `evaluateFindings` like
  any criterion finding. Use the same field for other conversation-raised findings.

## 6. Moving from demo to production (for the team)

See §8 for the full roadmap: Supabase schema, telephony (Twilio + a voice model), auth, and where each domain
action plugs into a webhook.

## 7. Open decisions (do NOT treat as approved)

Copied from the specs — the MVP picks a placeholder behavior and marks it in code with `OPEN DECISION`:
1. Basic missed-notification callback. **Settled:** owners cannot call NAQAH; NAQAH always places the call.
2. Can Basic relay instructions without tickets? **No.** Basic does not ask for or relay instructions. (Supersedes diagram f3.)
3. Owner phoning in. **Settled:** a short closed line, on every plan.
4. Unregistered caller handling. (MVP: Call Lab only simulates the registered worker)
5. Ultimate second daily report attempt. (MVP: politely rejected)
6. Tasks on owner-initiated calls. **Settled:** owner-initiated calls do not exist.
7. Retry exhaustion. **Settled:** three worker attempts, 20 minutes apart, then stop. No new No Answer Ticket. Open tasks stay open. Historical tickets still close when the worker calls back.
8. How emergency categories are used during calls. (MVP: shown to the owner; worker calls owner directly)
9. Predefined question categories and wording. (MVP: DRAFT in `catalog.ts`)
10. AI model, voice/telephony provider and payment processing. (MVP: none — simulated; display-only plan prices are set below)

## 8. Production roadmap (demo → real service)

The demo keeps one `Workspace` in `localStorage`. Every rule is a pure function in `src/domain`, so production keeps
the same functions and swaps only the storage and the "who triggers it" layer.

### 8.1 Database — Supabase (free tier is enough to start)
- Schema, applied in filename order from `supabase/migrations/` (Postgres 15+):
  `0001_init`, `0002_backend_foundation`, `0003_voice_call_sessions`, `0004_owner_write_limits`,
  `0005_custom_question_retry`, `20261107213717_owner_flow`, `20261108000000_pending_worker_call_tasks`,
  `20261108010000_initial_plan_selection`, `20261109000000_rate_limits`, `20261109120000_test_calls`,
  `20261109130000_report_mode_coverage`, `20261109140000_report_mode_settings`,
  `20261109182526_owner_summary_schedule`, `20261110090000_mvp_owner_runs`, `20261113090000_report_call_scheduler`,
  `20261113100000_worker_call_claims`.
  Hosted: everything through `20261110090000` (see Current state); the last two are not applied.
  Local validation uses stand-in Supabase roles/Auth; it does not prove live activation.
  Status, plan and manual go-live list: `docs/integrations/supabase-backend.md`.
  One owner (`auth.users`) → one `farms` row (owner, settings, call time, herd count, primary worker) → 1–3 (Basic) or
  1–10 (Ultimate) `workers` rows; NAQAH calls the primary one. Scheduled report calls live in `report_call_runs`.
  Child tables mirror `types.ts`: `camels`, `resources`, `custom_questions` (DB trigger enforces Basic ≤ 5),
  `criteria`, `emergency_categories`, `calls`, `reports` + `report_answers` + `findings`, `task_tickets`, `relays`,
  `pending_worker_calls` + `pending_worker_call_tasks` + `worker_call_attempts`, `no_answer_tickets`, `events`,
  `predefined_questions` (global).
- RLS: owners read/write their farm's settings, herd, resources, questions, criteria, relays and events; they can
  only **read** calls, reports, tickets and retries — those are written by the voice service with the
  `service_role` key (server only, bypasses RLS). Never ship the service key to the browser.
- Activation is a separate owner-authorized phase on the existing project, not permission to create another project,
  run live migrations, change Auth users/settings or deploy during code-readiness work. Follow `supabase-preparation.md`.
  Current variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (Auth/browser),
  `NEXT_PUBLIC_NAQAH_ACCOUNT_DATA` (account opt-in), `SUPABASE_SECRET_KEY` (voice/service only).
- Migration path in the app: see `docs/integrations/supabase-backend.md`. Call outcomes go through `runFarmAction`: load the
  farm into a `Workspace`, run the pure action, diff and persist in one transaction. Keep `clockOffsetMs` demo-only.

### 8.2 Auth
Supabase Auth supports phone OTP, email/password and Google OAuth for the owner. Provider configuration and real
verification remain distinct from mocked Auth checks. The worker never logs in; they
are recognised by caller ID (`workers.phone`) — an identification signal only, not proof (open decision 4).

### 8.3 Telephony + voice agent
- Numbers and calls: Twilio Programmable Voice (Saudi numbers need a regulatory bundle) or a local carrier SIP trunk.
- Voice brain: a realtime speech-to-speech model connected to the Twilio media stream, or STT → LLM → TTS. The
  scripted engine in `src/domain/conversation/` is the **reference behaviour**: question order, follow-ups,
  confirmations, "I don't know", certainty labels. Use it as the tool/state layer and let the model only phrase the
  turns. The model must call tools (below) and may say "saved" only after the tool returns success.
- **No recordings**: disable Twilio recording and transcription storage; persist only extracted facts. The one exception is the opt-in local debug trace (`NAQAH_CALL_TRACE_DIR`, `--trace-transcripts` on the local test stack) for consenting test participants: temp directory only, deleted after 24 hours, refused on Vercel or with a non-loopback database.

### 8.4 Webhook → domain action map
The implemented contract is `docs/integrations/voice-data-contract.md`.

| Event | Route handler | Domain functions |
|---|---|---|
| Scheduler tick | `GET /api/cron/report-calls`, `Bearer CRON_SECRET`. Supabase `pg_cron` + `pg_net` call it every 5 min once activated; it dials only with farm mode, Twilio and `NAQAH_SCHEDULED_CALLS=1` | per farm: due report call, then a due worker instruction/verification call, then the owner's due summary call (`src/server/calls/scheduler.ts`) |
| Report call due | the scheduler tick | `claimDueReportCall` → Twilio dial |
| Report call answered / ended | `POST /api/voice/outbound`, `/api/voice/outbound/status` (signed token, not caller ID) | `answerReportCall`, report conversation, `resolveReportCallAttempt` (3 attempts, 20 min apart → missed), `endReportCallWithoutReport` |
| Realtime report call | `/api/voice/realtime/session` (bridge presents the stream ticket), `/tool` (one model tool call = one engine step), `/after` (stream closed, call still up), `/closed` (diagnostic only) | same engine and save path as the scripted call |
| Scripted call turns | `POST /api/voice/turn` (each Gather), `POST /api/voice/status` (call ended: clears the working state) | engine `answer`, `applyVoiceEvent` |
| Report finished | `submit_report` / `confirm_report` (realtime) or the scripted read-back | `worker_report` event → `evaluateFindings`, `completeWorkerReport` |
| Owner summary call | scheduler tick at the owner's slot, whether or not a report exists. Never inside the report webhook. `/api/voice/owner`, `/owner/heard` (Basic summary fully spoken), `/owner/status` | `claimDueOwnerCall`, `ownerSummaryText`, `resolveOwnerCallAttempt` |
| Owner gives instruction | spoken on the Ultimate summary call; AI proposes, owner verifies the read-back | realtime `propose_instructions`, `confirm_instructions` (scripted fallback asks the owner), `submitOwnerInstructionBatch` |
| Instruction or verification call | scheduler tick. `/api/voice/worker`, `/worker/status`. Answering is not delivery | `claimDueWorkerCall`, `resolveWorkerCallAttempt` (`delivered` only when `completed`) |
| Scheduled task check | the same worker call, after the instruction was delivered | `dueTaskVerifications`, `startTaskVerification`, `confirmTask` on an explicit yes |
| Worker calls in | `POST /api/voice/inbound` (caller = worker) | `routeWorkerInboundCall` → callback (`completeWorkerCallback`, not a farm update) / returned missed report call / "NAQAH will call you" |
| Owner calls in | `POST /api/voice/inbound` (caller = owner) | none: a short closed line (`OWNER_LINE_CLOSED`) on every plan |
| Owner's "Call now" | Server Action `callWorkerNow` (`NAQAH_MANUAL_REPORT_CALLS=1`); `GET /api/report-call-now` for the run's state and free preflight; `POST` is the bridge's signed preflight | `requestReportCallNow`: one report-call attempt, 3 an hour / 10 a day per ranch |
| Owner call now (local demo only) | Server Action `callOwnerNow`; `GET /api/owner-call-now` (state, preflight), `POST /api/test-number` (approve a number). Never on Vercel | `requestOwnerCallNow` to the farm's approved owner number |
| Admin test call | `GET`/`POST /api/test-call` (`NAQAH_TEST_CALLS=1`, listed admin, ranch in `test_call_ranches`) | outbound report call through the normal save path |
| Owner's dashboard data | `POST /api/account` (404 unless account mode) | owner actions through RLS |
| Emergency | none: the worker calls the owner directly | — |

Vercel Hobby cron runs at most once a day, so the trigger is Supabase `pg_cron` + `pg_net` every 5 minutes
(`20261113090000_report_call_scheduler.sql`; URL and secret in Vault, idle until both are set). Checklist:
`twilio-activation.md`.

### 8.5 Payments and displayed prices
Payment processing is out of scope for the MVP; showing prices does not charge or subscribe an owner. The public
monthly price per ranch is Basic: SAR 299 before VAT (SAR 344 including 15% VAT), and Ultimate: SAR 999 before VAT
(SAR 1,149 including 15% VAT). When payment processing is approved: Moyasar or Tap (Saudi) or Stripe, with the plan
stored on `farms.plan`.

### 8.6 Deployment
Vercel Hobby (free). `NEXT_PUBLIC_SITE_URL` is used for metadata/OG URLs. No other environment variables are needed
for the demo.

## 9. Testing & QA checklist
- `npm test` covers the domain and the conversation engine. Add a test for every new rule.
- Visual QA: check every page at 375px and 1440px, in `/ar` and `/en` (no horizontal scroll, RTL mirroring,
  Latin digits, 44px targets). Playwright is installed as a dev dependency for this.
- The demo clock (`clockOffsetMs`) is the only way to test windows and retries. Never use `Date.now()` in rules.
- `scripts/qa-screens.mjs` screenshots every page (ar/en × 375/1440) against a running server and flags overflow
  and console errors. **Always run it against `npm run build && npx next start`**, not only `next dev` — two bugs
  below only showed up in production.

### Design rules (2026-11 distill pass, updated by Product Experience 2.0)

These rules keep NAQAH from looking generic. They are guardrails, not a ceiling: the owner wants a premium,
visually rich product, so a rule may be broken deliberately when it clearly blocks a better result. Record the
exception here.

- No pills for status. `Badge`, `HealthBadge`, `CertaintyBadge` and `OutcomeBadge` render coloured text (with an optional dot). Certainty is quiet provenance text, never a chip. Status is never shown by colour alone.
- No icon tiles, eyebrow labels, numbered 01/02/03 steps, same-size icon card grids, or decorative SVG waves/blobs. `CardHeader` shows an icon inline only, never in a tinted square.
- Cards have a hairline border and no shadow, and are never nested. Overlays are the exception: `Sheet` and dialogs sit on a dimmed backdrop with elevation.
- Visuals carry real data only (labelled samples in the demo and the landing) and must read well with one report or none. Timelines share one language from `src/components/visuals/`: a filled mark happened, a ring is still to come. Every visual has a text equivalent for screen readers.
- The Overview answers first: the espresso estate header holds the ranch name, a one-sentence answer, the report rhythm strip and the next call. Below it, what needs attention, the latest report as a timestamped ledger, and the herd. Say each fact once. Camels appear by name and open their sheet.
- Espresso fill is reserved for the estate header and the "your ranch's week" card in onboarding and Settings.
- Soft tints are allowed only for: findings inside a report, an unanswered check inside its task, the emergency strip (sand), and a warning that would lose unsaved work. Never tint whole cards to call attention.
- The herd count may sit large beside the herd mark field; other numbers stay inline with their label.
- The dashboard's call row sits in the estate header right under the answer, before the week strip (`CallBar`): «ناقة تتصل على …», the worker's number with «تغيير الرقم» (opens Settings → workers), and two actions: «محاكاة مكالمة» first, «اتصال حقيقي» beside it. In an account the simulation opens `/app/simulate`, where the report engine runs on an in-memory copy of the ranch and never writes to the store, the account or the phone line; the real call is the existing `ReportCallNow` with its number confirmation, always visible and disabled with a plain reason where this site has calling off. In the demo the simulation opens the Call Lab on the report call, and the real call explains it needs a signed-in ranch. «مواعيد المكالمات» sits with the next-call times (exception recorded Nov 2026 at the owner's request: calling must be one obvious step).
- The landing is one photographic story: hero with the sample evening rail, the scroll-led `CallStory` (worker's call → report → owner's call → dashboard), principles with the retry rail, `PlanWeeks` with "Compare every detail", and the closing invitation. Dark scrims under text on photos are allowed for contrast. Times above story steps are timeline markers, not eyebrows. Say each fact once; landing copy lives only in `src/i18n/messages/landing.ts`. Photos and their credits are tracked in `docs/design/asset-ledger.md`.
- Arabic pages lead with Alexandria (`--font-arabic`). next/font's "Montserrat Fallback" covers every codepoint, so with Montserrat first, Arabic renders in Arial.
- Motion is subtle and meaningful (entrances, state changes, sheets), never hides content, and stops under `prefers-reduced-motion`.
  Exception (owner request, Nov 2026): the landing hero photograph is scroll-linked (`HeroDrift` + `.naqah-drift`): the further the page scrolls, the further the herd moves to the right (physical right in both languages). It is driven by the reader's scroll, never a perpetual loop, and stays still under reduced motion.

### Known pitfalls (learned the hard way)
- **Store hydration:** localStorage rehydration runs *inside* zustand's `create()`, before `useWorkspaceStore` is
  assigned. `onRehydrateStorage` must use the state it is given (`markHydrated()`), never the exported store —
  otherwise the dashboard is stuck on the loading camel in production.
- **Prerender + Cache Components:** a client component must not call `new Date()` / `Date.now()` during the first
  render (e.g. a `useState(() => createEmptyWorkspace())` initializer). The build fails on `/[locale]/start`.
  Create such values in an event handler, an effect, or only when actually needed on the client.
- **Answers in two languages:** fixed-choice answers carry `answerText {ar,en}`; free text stays in `answer` exactly
  as said. Render `answerText ? t(answerText) : answer`.
- **`.ltr-nums` sets `direction` on the element itself,** which flips its own `start-*`/`end-*` positioning. Position a
  wrapper instead and keep `.ltr-nums` on the inner text.
- **Arabic has no short weekday names** (`weekday: "short"` returns the full name). Tight seven-day strips use the
  one-letter `narrow` forms (ح ن ث …) and keep the full name for screen readers.
- **Heavy client SDKs:** load the Supabase browser client through `src/lib/supabase/lazy-client.ts` everywhere except
  sign-in forms, so the landing, onboarding and the demo never download it.
- **Names in the Call Lab:** engine and lab copy were written with the sample names; `personalize.ts` swaps them.
  When the real voice agent arrives, pass names explicitly instead (TODO in that file).
