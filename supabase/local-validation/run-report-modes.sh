#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
export PGHOST=127.0.0.1 PGPORT=54460 PGUSER="$(id -un)" NAQAH_TEST_DB=naqah_report_modes_local
unset PGHOSTADDR PGSERVICE PGSERVICEFILE PGPASSFILE PGDATABASE
DATA=$(mktemp -d "$ROOT/.report-modes-pg.XXXXXX")
cleanup() {
  pg_ctl -D "$DATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$DATA"
}
trap cleanup EXIT HUP INT TERM
initdb -D "$DATA" -A trust --no-locale >/dev/null
pg_ctl -D "$DATA" -l "$DATA/server.log" -o "-h 127.0.0.1 -p 54460 -k $DATA" -w start >/dev/null
createdb "$NAQAH_TEST_DB"
psql -X -q -v ON_ERROR_STOP=1 -d "$NAQAH_TEST_DB" -f "$ROOT/supabase/local-validation/bootstrap.sql" >/dev/null
for migration in "$ROOT"/supabase/migrations/*.sql; do
  psql -X -q -v ON_ERROR_STOP=1 -d "$NAQAH_TEST_DB" -1 -f "$migration" >/dev/null
done
cd "$ROOT"
node node_modules/vitest/vitest.mjs run src/server/db/round-trip.pg.test.ts src/server/db/report-modes.pg.test.ts --testTimeout=30000
