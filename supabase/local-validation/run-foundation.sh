#!/bin/sh
# LOCAL ONLY. Rebuilds a throwaway database with both migrations and runs the 0002 checks,
# then the original isolation suite on the combined schema, then the domain round trip.
# Needs a disposable local Postgres 15+ through the usual PG* variables (see run.sh).
set -eu
cd "$(dirname "$0")"
DB="${NAQAH_TEST_DB:-naqah_foundation}"
PSQL="psql -X -q -v ON_ERROR_STOP=1"

fresh() {
  $PSQL -d postgres -c "drop database if exists $DB" 2>/dev/null
  $PSQL -d postgres -c "create database $DB"
  $PSQL -d "$DB" -f bootstrap.sql
  $PSQL -d "$DB" -1 -f ../migrations/0001_init.sql
  $PSQL -d "$DB" -1 -f ../migrations/0002_backend_foundation.sql
}

echo "-- 0002 checks"
fresh
$PSQL -d "$DB" -A -t -f backend_foundation.sql | grep -E "PASS|FAIL|^[0-9]+\|[0-9]+$"

echo "-- 0001 isolation suite on the combined schema"
fresh
# Expect one FAIL: "no functions in public" predates apply_farm_changes, the single RPC, which
# only service_role can run (backend_foundation.sql checks that).
$PSQL -d "$DB" -A -t -f owner_isolation.sql | grep -E "FAIL|^[0-9]+\|[0-9]+$"

echo "-- race: two saves from the same revision (expect one NQ409, revision 1)"
fresh
FARM="insert into auth.users values ('00000000-0000-0000-0000-00000000000a'); insert into farms (owner_id) values ('00000000-0000-0000-0000-00000000000a');"
$PSQL -d "$DB" -c "$FARM"
$PSQL -d "$DB" -c "set role service_role" -c "begin; select apply_farm_changes(id, 0, '{}'::jsonb) from farms; select pg_sleep(2); commit;" >/dev/null 2>&1 &
sleep 0.5
$PSQL -d "$DB" -c "set role service_role" -c "select apply_farm_changes(id, 0, '{}'::jsonb) from farms" 2>&1 | grep -E "ERROR" || echo "second save committed"
wait
$PSQL -d "$DB" -A -t -c "select 'revision=' || revision from farms"

echo "-- race: the same event twice, second on the fresh revision (expect unique violation, revision 1)"
fresh
$PSQL -d "$DB" -c "$FARM"
$PSQL -d "$DB" -c "set role service_role" -c "begin; select apply_farm_changes(id, 0, '{}'::jsonb, 'CA1:report', '{}') from farms; select pg_sleep(2); commit;" >/dev/null 2>&1 &
sleep 0.5
$PSQL -d "$DB" -c "set role service_role" -c "select pg_sleep(2.5); select apply_farm_changes(id, 1, '{}'::jsonb, 'CA1:report', '{}') from farms" 2>&1 | grep -E "ERROR" || echo "second event committed"
wait
$PSQL -d "$DB" -A -t -c "select 'revision=' || revision || ' events=' || (select count(*) from voice_events) from farms"

echo "-- domain round trip"
fresh
cd ../..
NAQAH_TEST_DB="$DB" npx vitest run src/server/db/round-trip.pg.test.ts 2>&1 | grep -E "FAIL|AssertionError|Error:|Test Files|Tests "
