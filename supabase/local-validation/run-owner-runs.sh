#!/bin/sh
# LOCAL ONLY. Every migration on a throwaway Postgres (port 54500), then the owner-run and round-trip tests.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
# Without a valid locale, macOS postgres stops with "postmaster became multithreaded during startup".
export LC_ALL=en_US.UTF-8
export PGHOST=127.0.0.1 PGPORT=54500 PGUSER="$(id -un)" NAQAH_TEST_DB=naqah_owner_runs_local
unset PGHOSTADDR PGSERVICE PGSERVICEFILE PGPASSFILE PGDATABASE
DATA=$(mktemp -d /tmp/naqah-owner-runs-pg.XXXXXX)
cleanup() {
  pg_ctl -D "$DATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$DATA"
}
trap cleanup EXIT HUP INT TERM
initdb -D "$DATA" -A trust -E UTF8 --no-locale >/dev/null
pg_ctl -D "$DATA" -l "$DATA/server.log" -o "-h 127.0.0.1 -p 54500 -k $DATA" -w start >/dev/null
createdb "$NAQAH_TEST_DB"
psql -X -q -v ON_ERROR_STOP=1 -d "$NAQAH_TEST_DB" -f "$ROOT/supabase/local-validation/bootstrap.sql" >/dev/null
apply() { psql -X -q -v ON_ERROR_STOP=1 -d "$NAQAH_TEST_DB" -1 -f "$1" >/dev/null; }
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
