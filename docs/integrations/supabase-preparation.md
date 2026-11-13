# Supabase database handoff

> **Historical (2026-11-07).** The hosted project has since been migrated through `20261110090000`; the current
> status and full migration list are in `supabase-backend.md` and `AGENT.md` §8.1. Keep this file for the first-time
> bootstrap steps and the review notes below.

Status (2026-11-07): Auth, account-data integration and farm-mode call storage already exist in code.
The latest team report says the existing project has Auth test users but no NAQAH application migrations
(issue #6). This is not a new live inspection. No live migration, account/settings change or deployment is
authorized during code-readiness work. Local tests use disposable Postgres 17.6 and stand-in roles/Auth.

The browser demo remains separate. The exact build-time `NEXT_PUBLIC_NAQAH_ACCOUNT_DATA=1` enables
account UI and server access together; disabled `/api/account` returns 404 without database operations.
Farm-mode voice has its own flag and team ownership. Applying SQL alone activates neither path.

## Initial migration sequence (later migrations: see `supabase-backend.md`)

1. `0001_init.sql`: initial tables, grants, RLS, parent constraints and plan limits.
2. `0002_backend_foundation.sql`: revisions, atomic service writes, event idempotency and same-farm links.
3. `0003_voice_call_sessions.sql`: structured in-progress call state, no recordings/transcripts.
4. `0004_owner_write_limits.sql`: owner write constraints and no direct farm deletion.
5. `0005_custom_question_retry.sql`: same-farm fifth-question upsert retries without weakening the Basic cap.

Keep historical migrations intact. Add forward fixes; an existing migration history determines which are pending.

## Historical review of 0001

The initial pre-activation review revised 0001 in place. That is historical context, not guidance to rewrite it now.

| Area | Change |
|---|---|
| Basic's 5 custom questions | Limit trigger kept on insert, locks the farm row, and runs as the caller so an owner's insert into another farm is rejected by RLS without reading or locking that farm. `farm_id` can no longer change, so a question cannot be moved into a full Basic farm. Downgrade check unchanged. Concurrent inserts and insert-vs-downgrade races were tested. |
| Same-farm relationships | `calls → task_tickets/reports`, `reports → calls`, `pending_worker_calls → task_tickets/relays` and `no_answer_tickets → task_tickets` are now `(farm_id, id)` foreign keys with `on delete set null (column)` (Postgres 15+). A finding's criterion must belong to its report's farm (trigger). Rows never change `farm_id`, `report_id` or `pending_call_id` after creation. |
| Functions | All helpers moved to a `private` schema that the Data API does not expose, each with `search_path = ''` and schema-qualified names. Trigger functions cannot be executed by `anon`/`authenticated`. `private.is_farm_owner` is the only SECURITY DEFINER function; only `authenticated` may execute it. The unneeded `pgcrypto` extension line was removed (`gen_random_uuid()` is built in). |
| Grants and RLS | Table privileges are explicit instead of inherited from Supabase defaults: `anon` gets nothing; `authenticated` gets only what its policies need (no TRUNCATE, TRIGGER or REFERENCES); `service_role` gets all. Farm billing/bookkeeping columns stay service-only. Policies use `(select auth.uid())`. Subscription rules are unchanged. |
| Optional setup | Removed `basic_needs_window`: owners may finish or skip setup without a schedule; Basic reporting without a valid window is still rejected by `src/domain/rules.ts`. A window draft may hold the day before the times; times require a day and the end must follow the start. Worker name/phone default to empty. Added nullable farm coordinates (both or neither) and supplier contact columns so existing optional settings have somewhere to live. |
| Camels | `tag` stays (`not null default ''`): new camels get an empty tag; existing tags are kept when the edit form omits them. |

## Historical 0001 validation results (local only)

`sh supabase/local-validation/run.sh` against a disposable Postgres 17.6:

- Migration applies cleanly in one transaction.
- 63 of 63 checks pass: owner A/B isolation on every table; anon denied everywhere; owner writes
  to plan, bookkeeping and service-written tables denied; the 6th Basic question rejected for owners
  and the service; moves between farms rejected; downgrade above 5 rejected and allowed at 5;
  every cross-farm link rejected while same-farm links work; deleting a ticket keeps the linked
  call and pending call; RLS on every table; no functions in `public`; pinned search paths;
  no TRUNCATE/TRIGGER/REFERENCES for `authenticated`.
- Races: two simultaneous inserts at 4 of 5 → one rejected, 5 stored. Downgrade (uncommitted)
  vs insert → insert rejected, Basic with 5.
- The original migration, run the same way, rejected a skipped Basic setup and an empty worker,
  accepted a cross-farm call → ticket link, let a 6th question be moved into a Basic farm, gave
  `anon` execute on `is_farm_owner` and `authenticated` TRUNCATE.

Not verified (needs the real project): Supabase's actual roles, default privileges and `auth.uid()`
(the stand-in mimics them), Security/Performance Advisor output, PostgREST/GraphQL exposure,
generated types, phone OTP. The scripts under `supabase/local-validation/` are **local only**:
`bootstrap.sql` creates roles and an `auth` schema and must never run on a Supabase project.

## Manual next phase: apply to the existing project only after authorization

These commands are a future checklist, **not commands run in the readiness phase**. The project owner must
authorize and perform activation on the existing `ydsgmzxqjimwbamnksxe`. Do not create another project or
alter existing Auth test users to make application migrations work. Never run `local-validation/bootstrap.sql`
or any local-validation runner against hosted Supabase.

1. **Check the project.** Dashboard → Database → Migrations is empty, Table Editor shows no
   tables in `public`, and Settings → Infrastructure shows Postgres 15 or newer. If anything is
   already there, stop: this is a non-idempotent initial migration.
2. **Check API exposure.** Settings → Data API → Exposed schemas lists `public` (and
   `graphql_public`) only. Do not add `private`.
3. **Link.**
   ```bash
   npx supabase@latest login
   npx supabase@latest link --project-ref ydsgmzxqjimwbamnksxe
   ```
   If the CLI reports that the project is not initialised, run `npx supabase@latest init` first
   (it adds `supabase/config.toml`; commit it with the migration later if you keep it).
4. **Preview, then apply.**
   ```bash
   npx supabase@latest db push --dry-run   # empty application schema/history: must list 0001 through 0005
   npx supabase@latest db push
   npx supabase@latest migration list      # local and remote both show all five
   ```
5. **Verify in the SQL editor** (read-only):
   ```sql
   select relname from pg_class
   where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity;  -- expect 0 rows
   select proname, proconfig from pg_proc where pronamespace = 'private'::regnamespace;  -- 6 rows, search_path=""
   select count(*) from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public';                                  -- expect 0
   select count(*) from predefined_questions;                                           -- expect 7
   ```
6. **Advisors.** Dashboard → Advisors → Security and Performance. Expect no findings for NAQAH
   objects; note any that remain and send them back for review.
7. **Isolation on the real project.** Use two explicitly approved test owners and real sessions (A cannot
   read or write B; anon reads nothing). Confirm account setup/edit/reload, cross-tab owner switch and
   fifth-question retry. Do not delete or change existing Auth users without separate approval.
8. **Separate activation.** Verify required providers/redirects and obtain approval before setting
   `NEXT_PUBLIC_NAQAH_ACCOUNT_DATA=1` and rebuilding/deploying. SMS, voice and schedulers remain separate,
   disabled until their owners authorize them. Rollback limitations are in `supabase-backend.md`.

## After the schema is live

- Environment names (values stay out of git and chat; `.env.local` is ignored):
  ```dotenv
  NEXT_PUBLIC_SUPABASE_URL=
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
  NEXT_PUBLIC_NAQAH_ACCOUNT_DATA=
  SUPABASE_SECRET_KEY=
  ```
  Auth and owner CRUD use the publishable key with the validated session/RLS. The secret key is for the
  service/voice path only: never `NEXT_PUBLIC_`, never in logs. `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is the optional
  public CAPTCHA site key; provider settings and secrets are separate manual configuration.
- The existing app integration maps empty optional strings to `''`, window times not yet chosen to
  `null`, and delete (not save) a custom question whose text is cleared, because blank question
  text is rejected.
- `report_answers.question_id` is a text snapshot, not a foreign key; the voice service must only
  write ids from the same farm.
- `Workspace.weather` is a refreshable browser forecast cache and is not stored. The
  `latitude`/`longitude` and `supplier_*` columns map to `Farm.coords` and
  `Settings.integrations`.
- The schema requires Postgres 15+; local validation does not verify Supabase's real gateway/Auth configuration.
- Phone OTP needs an SMS provider and charges on the account; do not claim it works until a test
  the owner authorised succeeds. Set exact auth redirect URLs; no wildcard production redirects.
