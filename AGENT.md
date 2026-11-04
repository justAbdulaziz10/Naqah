# NAQAH | ناقة — Project Handbook (AGENT.md)

> **Read this first.** It is the single source of truth for humans and AI agents working on this repo:
> what the product is, which rules are confirmed, how the code is organized, and what is still open.

**Status:** Investor MVP / demo (November 2026). No real phone calls, no payments, no subscriptions are charged.
Everything runs in the browser so the demo link never breaks and costs nothing to host.

---

## 1. Product in one paragraph

NAQAH is private camel-ranch operations management for **one owner, one farm, one worker**. The **worker** uses an ordinary
phone (no app): they call the NAQAH AI voice agent, which asks the owner-configured questions, records structured facts
(never audio), and updates the farm. Right after a successful update the AI **calls the owner** with only what matters.
The **owner** uses a website (this app) to set up the farm, see the latest state, and track tickets.
Brand promise: **Peace of Mind — «اطمئنان، دون انشغال»**. Personality: *The Quiet Steward*.

## 2. Confirmed rules (from the MVP workflow diagrams Phases 1–10)

| Area | Basic | Ultimate |
|---|---|---|
| Custom questions (owner-written) | up to **5** | unlimited |
| Predefined questions (NAQAH team) | mandatory when applicable; skipped if the resource is absent | same |
| Worker reporting | **one per week**, only inside the owner's weekly window (owner sets day + start + end; no default duration) | **one per day**, whenever the worker chooses (marks the end of their workday) |
| Owner calls the AI | **one call per week** (an answered notification call consumes it) | unlimited |
| Missed notification | owner may call back **once** (this MVP counts it as the weekly call — *open decision*) | unlimited anyway |
| Owner instructions during post-update call | relayed to the worker, **no ticket** | actionable → **Task Ticket** (OPEN) with a time or "any time"; information-only → no ticket |
| Task tickets | — | close **only** when the worker explicitly confirms; deadlines never close them; closed → History |
| Task verification | — | scheduled time → AI calls the worker; "any time" → asked during later worker interactions |
| AI → worker no answer | retry after **20 min**, up to **3 retries**, then **No Answer Ticket** | same |
| Worker returns missed call | always answered (even outside the window); delivers missed messages; closes the No Answer Ticket; **not** a farm update and does not consume the report | same |
| Emergency | worker calls the owner **directly** — never through the AI | same |

Agent behavior (from `NAQAH_AI_Agent_Identity_DRAFT_v0.1`): identifies itself as automated; one question at a time;
accepts «ما أدري» / "I don't know"; confirms quantities and camel names; never diagnoses; never claims
"saved/notified/created" before the system confirms; labels facts as *reported / approximate / unknown / verified*;
never presents old data as new; stores extracted facts only (**no recordings**).

**Do not add** (not approved): native apps, a website chatbot, multiple farms/workers, diagnosis, purchasing,
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
   │   ├─ seed.ts               empty workspace + sample demo farm
   │   └─ rules.test.ts         Vitest coverage of every rule above
   ├─ store/workspace.ts        zustand store persisted to localStorage (`naqah-workspace-v1`)
   ├─ i18n/                     config, formatting (Riyadh time, Latin digits), messages per slice
   ├─ components/ui/            design-system primitives (Button, Card, Badge, Field, Switch, Segmented)
   ├─ components/brand/         CamelMark (approved logo, traced 1:1) and Logo lockup
   └─ components/shell/         AppShell (dashboard nav), LocaleSwitcher, DemoClock
supabase/migrations/            production schema (not used by the demo yet) — see §6
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
  not stiff MSA. Cut helper text a layout doesn't need.
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

## 6. Moving from demo to production (for the team)

See §8 for the full roadmap: Supabase schema, telephony (Twilio + a voice model), auth, and where each domain
action plugs into a webhook.

## 7. Open decisions (do NOT treat as approved)

Copied from the specs — the MVP picks a placeholder behavior and marks it in code with `OPEN DECISION`:
1. Basic missed-notification callback: does it consume the weekly owner call? (MVP: yes)
2. Can Basic relay instructions without tickets? (MVP: yes, per diagram f3)
3. Exact response when Basic's owner allowance is used. (MVP: polite refusal + "details are on the website")
4. Unregistered caller handling. (MVP: Call Lab only simulates the registered worker)
5. Ultimate second daily report attempt. (MVP: politely rejected)
6. Whether tasks can be created during owner-initiated inquiry calls. (MVP: no)
7. Retry scope/exhaustion beyond the No Answer Ticket. (MVP: ticket stays open until callback)
8. How emergency categories are used during calls. (MVP: shown to the owner; worker calls owner directly)
9. Predefined question categories and wording. (MVP: DRAFT in `catalog.ts`)
10. AI model, voice/telephony provider, payments and prices. (MVP: none — simulated)

## 8. Production roadmap (demo → real service)

The demo keeps one `Workspace` in `localStorage`. Every rule is a pure function in `src/domain`, so production keeps
the same functions and swaps only the storage and the "who triggers it" layer.

### 8.1 Database — Supabase (free tier is enough to start)
- Schema: `supabase/migrations/0001_init.sql` (validated on Postgres 14 with a stubbed `auth` schema; RLS tested).
  One owner (`auth.users`) → one `farms` row (holds owner + settings + Basic window) → one `workers` row.
  Child tables mirror `types.ts`: `camels`, `resources`, `custom_questions` (DB trigger enforces Basic ≤ 5),
  `criteria`, `emergency_categories`, `calls`, `reports` + `report_answers` + `findings`, `task_tickets`, `relays`,
  `pending_worker_calls` + `worker_call_attempts`, `no_answer_tickets`, `events`, `predefined_questions` (global).
- RLS: owners read/write their farm's settings, herd, resources, questions, criteria, relays and events; they can
  only **read** calls, reports, tickets and retries — those are written by the voice service with the
  `service_role` key (server only, bypasses RLS). Never ship the service key to the browser.
- Setup: create a project (the owner's Supabase account hit the 2-free-project limit during the build, so none was
  created), run `supabase link` then `supabase db push`, and add `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` (browser) and `SUPABASE_SERVICE_ROLE_KEY` (server) to Vercel.
- Migration path in the app: write `src/store/supabase.ts` exposing the same `update(fn)` shape: load the farm into a
  `Workspace`, run the pure action, diff and persist. Keep `clockOffsetMs` demo-only (production uses real time).

### 8.2 Auth
Supabase Auth with phone OTP for the owner (matches the "ordinary phone" audience). The worker never logs in; they
are recognised by caller ID (`workers.phone`) — an identification signal only, not proof (open decision 4).

### 8.3 Telephony + voice agent
- Numbers and calls: Twilio Programmable Voice (Saudi numbers need a regulatory bundle) or a local carrier SIP trunk.
- Voice brain: a realtime speech-to-speech model connected to the Twilio media stream, or STT → LLM → TTS. The
  scripted engine in `src/domain/conversation/` is the **reference behaviour**: question order, follow-ups,
  confirmations, "I don't know", certainty labels. Use it as the tool/state layer and let the model only phrase the
  turns. The model must call tools (below) and may say "saved" only after the tool returns success.
- **No recordings**: disable Twilio recording and transcription storage; persist only extracted facts.

### 8.4 Webhook → domain action map
| Event | Route handler (suggested) | Domain functions |
|---|---|---|
| Worker calls in | `POST /api/voice/inbound` (caller = worker) | `routeWorkerInboundCall` → report / `rejectWorkerReport` / callback |
| Report finished | tool `save_report` | `evaluateFindings`, `completeWorkerReport` |
| Notify owner | outbound call right after save | `ownerBriefing`, `recordOwnerNotification(answered)` |
| Owner gives instruction | tool `submit_instruction` | `submitOwnerInstruction` (Ultimate actionable → task ticket) |
| Retry scheduler | Vercel Cron every 5 min → `GET /api/cron/worker-calls` | `dueWorkerCalls`, `resolveWorkerCallAttempt` (20 min × 3 → No Answer ticket) |
| Scheduled task check | same cron | `dueTaskVerifications`, `startTaskVerification`, `confirmTask` |
| Worker returns missed call | `POST /api/voice/inbound` | `completeWorkerCallback` (not a farm update) |
| Owner calls in | `POST /api/voice/inbound` (caller = owner) | `routeOwnerInboundCall` → `recordOwnerInquiry` / `rejectOwnerInquiry` |
| Emergency | none: the worker calls the owner directly | — |

Note: Vercel Hobby cron runs at most once a day; the 20-minute retry needs Vercel Pro, Supabase `pg_cron`
(free) calling the route, or Twilio's own scheduling.

### 8.5 Payments
Out of scope for the MVP (no prices shown, nothing charged). When decided: Moyasar or Tap (Saudi) or Stripe, with the
plan stored on `farms.plan`.

### 8.6 Deployment
Vercel Hobby (free). `NEXT_PUBLIC_SITE_URL` is used for metadata/OG URLs. No other environment variables are needed
for the demo.

## 9. Testing & QA checklist
- `npm test` covers the domain and the conversation engine. Add a test for every new rule.
- Visual QA: check every page at 375px and 1440px, in `/ar` and `/en` (no horizontal scroll, RTL mirroring,
  Latin digits, 44px targets). Playwright is installed as a dev dependency for this.
- The demo clock (`clockOffsetMs`) is the only way to test windows and retries. Never use `Date.now()` in rules.
