# Report mode storage validation

Run from the repository root:

```sh
sh supabase/local-validation/run-report-modes.sh
```

The runner creates its own PostgreSQL 17 cluster in a temporary directory inside this worktree,
using `/opt/homebrew/opt/postgresql@17/bin` and loopback port `54460`. It bootstraps the Supabase
roles locally, applies all migrations, and runs the domain round trip plus report-column checks.
It stops only its own cluster and removes its temporary data directory on exit, including failures.
It never connects to hosted Supabase or calls a voice provider.

Coverage includes mode and all three coverage statuses, the worker-labelled urgent finding,
legacy defaults, enum/container constraints, owner read isolation, service-only writes, and
transactional rollback of an invalid report's rows, event and revision.

## Deployment order

Apply `20261109130000_report_mode_coverage.sql` before deploying or enabling mode-bearing report
writes. The additive columns retain the existing reports table's grants and RLS. The RPC wrapper
stores report metadata within the original report transaction. No data backfill is needed.

Reads remain compatible before migration: the report query selects `*`, and row mapping treats
missing mode/coverage columns as legacy history. Legacy report payloads also remain valid on
either schema. However, the old RPC ignores unknown JSON keys, so it cannot persist mode/coverage
for new reports before this migration. Do not enable these writes against that old RPC: they
would save the report but lose its metadata. Migration first avoids both this loss and explicit
missing-column queries during the rolling deployment.
