# Supabase database handoff

Status (2026-11-05): `supabase/migrations/0001_init.sql` is reviewed, revised and validated on a
throwaway local Postgres 17.6 with a Supabase-like stand-in for roles and `auth`. It has **not**
been applied to any Supabase project. No account settings, keys or secrets were touched.

The app still uses localStorage and has no Supabase SDK. Applying this schema does not connect
the app or the phone line; that is later integration work (see "After the schema is live").

## What changed in the migration

The migration was never applied anywhere, so it was revised in place as one initial migration.

| Area | Change |
|---|---|
| Basic's 5 custom questions | Limit trigger kept on insert, locks the farm row, and runs as the caller so an owner's insert into another farm is rejected by RLS without reading or locking that farm. `farm_id` can no longer change, so a question cannot be moved into a full Basic farm. Downgrade check unchanged. Concurrent inserts and insert-vs-downgrade races were tested. |
| Same-farm relationships | `calls → task_tickets/reports`, `reports → calls`, `pending_worker_calls → task_tickets/relays` and `no_answer_tickets → task_tickets` are now `(farm_id, id)` foreign keys with `on delete set null (column)` (Postgres 15+). A finding's criterion must belong to its report's farm (trigger). Rows never change `farm_id`, `report_id` or `pending_call_id` after creation. |
| Functions | All helpers moved to a `private` schema that the Data API does not expose, each with `search_path = ''` and schema-qualified names. Trigger functions cannot be executed by `anon`/`authenticated`. `private.is_farm_owner` is the only SECURITY DEFINER function; only `authenticated` may execute it. The unneeded `pgcrypto` extension line was removed (`gen_random_uuid()` is built in). |
| Grants and RLS | Table privileges are explicit instead of inherited from Supabase defaults: `anon` gets nothing; `authenticated` gets only what its policies need (no TRUNCATE, TRIGGER or REFERENCES); `service_role` gets all. Farm billing/bookkeeping columns stay service-only. Policies use `(select auth.uid())`. Subscription rules are unchanged. |
| Optional setup | Removed `basic_needs_window`: owners may finish or skip setup without a schedule; Basic reporting without a valid window is still rejected by `src/domain/rules.ts`. A window draft may hold the day before the times; times require a day and the end must follow the start. Worker name/phone default to empty. Added nullable farm coordinates (both or neither) and supplier contact columns so existing optional settings have somewhere to live. |
| Camels | `tag` stays (`not null default ''`): new camels get an empty tag; existing tags are kept when the edit form omits them. |

## Validation results (local only)

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

## Apply once the project exists

Run from the repo root. Your friend owns the account: they log in and enter the database password.

1. **Check the project.** Dashboard → Database → Migrations is empty, Table Editor shows no
   tables in `public`, and Settings → Infrastructure shows Postgres 15 or newer. If anything is
   already there, stop: this is a non-idempotent initial migration.
2. **Check API exposure.** Settings → Data API → Exposed schemas lists `public` (and
   `graphql_public`) only. Do not add `private`.
3. **Link.**
   ```bash
   npx supabase@latest login
   npx supabase@latest link --project-ref <project-ref>
   ```
   If the CLI reports that the project is not initialised, run `npx supabase@latest init` first
   (it adds `supabase/config.toml`; commit it with the migration later if you keep it).
4. **Preview, then apply.**
   ```bash
   npx supabase@latest db push --dry-run   # must list only 0001_init.sql
   npx supabase@latest db push
   npx supabase@latest migration list      # local and remote both show 0001
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
7. **Isolation on the real project.** After owner login exists, create two test owners and repeat
   the owner checks with real sessions (A cannot read or write B; anon reads nothing). Delete the
   test users afterwards.

## After the schema is live

- Environment names (values stay out of git and chat; `.env.local` is ignored):
  ```dotenv
  NEXT_PUBLIC_SUPABASE_URL=
  NEXT_PUBLIC_SUPABASE_ANON_KEY=
  SUPABASE_SERVICE_ROLE_KEY=
  ```
  If the project issues a publishable key instead of an anon key, rename the variable and its
  consumers together. The service key is server-only: never `NEXT_PUBLIC_`, never in logs.
- The app integration should map empty optional strings to `''`, window times not yet chosen to
  `null`, and delete (not save) a custom question whose text is cleared, because blank question
  text is rejected.
- `report_answers.question_id` is a text snapshot, not a foreign key; the voice service must only
  write ids from the same farm.
- `src/domain/types.ts` has no field for `weather`; it is a refreshable forecast cache and is not
  stored. The new `latitude`/`longitude` and `supplier_*` columns map to `Farm.coords` and
  `Settings.integrations`.
- AGENT.md §8.1 still says "validated on Postgres 14"; the schema now needs Postgres 15+.
- Phone OTP needs an SMS provider and charges on the account; do not claim it works until a test
  the owner authorised succeeds. Set exact auth redirect URLs; no wildcard production redirects.
