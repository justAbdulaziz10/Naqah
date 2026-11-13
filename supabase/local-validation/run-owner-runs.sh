#!/bin/sh
# LOCAL ONLY. Every available migration on a throwaway Postgres, then owner-run and save-chain tests.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
# Without a valid locale, macOS postgres stops with "postmaster became multithreaded during startup".
export LC_ALL=en_US.UTF-8
export PGHOST=127.0.0.1 PGUSER="$(id -un)" NAQAH_TEST_DB=naqah_owner_runs_local
PGPORT=$(node -e 'const server = require("node:net").createServer(); server.listen(0, "127.0.0.1", () => { console.log(server.address().port); server.close(); });')
export PGPORT
unset PGHOSTADDR PGSERVICE PGSERVICEFILE PGPASSFILE PGDATABASE
DATA=$(mktemp -d /tmp/naqah-owner-runs-pg.XXXXXX)
cleanup() {
  pg_ctl -D "$DATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$DATA"
}
trap cleanup EXIT HUP INT TERM
initdb -D "$DATA" -A trust -E UTF8 --no-locale >/dev/null
pg_ctl -D "$DATA" -l "$DATA/server.log" -o "-h 127.0.0.1 -p $PGPORT -k $DATA" -w start >/dev/null
createdb "$NAQAH_TEST_DB"
psql -X -q -v ON_ERROR_STOP=1 -d "$NAQAH_TEST_DB" -f "$ROOT/supabase/local-validation/bootstrap.sql" >/dev/null
HAS_PG_CRON=$(psql -X -q -A -t -v ON_ERROR_STOP=1 -d "$NAQAH_TEST_DB" -c "select exists (select 1 from pg_available_extensions where name = 'pg_cron')")
apply() {
  if [ "$(basename "$1")" = "20261113090000_report_call_scheduler.sql" ] && [ "$HAS_PG_CRON" = "f" ]; then
    echo "Skipping scheduler migration: local pg_cron unavailable (save-function chain still applied)."
    return
  fi
  psql -X -q -v ON_ERROR_STOP=1 -d "$NAQAH_TEST_DB" -1 -f "$1" >/dev/null
}
LIVE_FIRST=20261109182526_owner_summary_schedule.sql
# --hosted-order applies the one migration hosted already has before the older ones it doesn't.
if [ "${1:-}" = "--hosted-order" ]; then
  for migration in "$ROOT"/supabase/migrations/*.sql; do
    case "$(basename "$migration")" in 2026110[0-8]*|000*) ;; *) continue ;; esac
    apply "$migration"
  done
  apply "$ROOT/supabase/migrations/$LIVE_FIRST"
  for migration in "$ROOT"/supabase/migrations/*.sql; do
    name=$(basename "$migration")
    case "$name" in 2026110[0-8]*|000*|"$LIVE_FIRST") continue ;; esac
    apply "$migration"
  done
else
  for migration in "$ROOT"/supabase/migrations/*.sql; do apply "$migration"; done
fi
cd "$ROOT"
node node_modules/vitest/vitest.mjs run src/server/db/owner-runs.pg.test.ts src/server/db/round-trip.pg.test.ts --testTimeout=30000
