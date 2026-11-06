#!/bin/sh
# LOCAL ONLY. Rebuilds a throwaway database, applies the migration and runs the checks.
# Needs a disposable local Postgres 15+ reachable through the usual PG* variables, e.g.
#   PGHOST=/tmp/naqah-pg PGPORT=54329 PGUSER=postgres sh supabase/local-validation/run.sh
# It drops and recreates the database named by NAQAH_TEST_DB (default naqah_test).
set -eu
cd "$(dirname "$0")"
DB="${NAQAH_TEST_DB:-naqah_test}"
PSQL="psql -X -q -v ON_ERROR_STOP=1"
A=00000000-0000-0000-0000-00000000000a
OWNER_A="set role authenticated; select set_config('request.jwt.claim.sub', '$A', false);"

fresh() {
  $PSQL -d postgres -c "drop database if exists $DB" 2>/dev/null
  $PSQL -d postgres -c "create database $DB"
  $PSQL -d "$DB" -f bootstrap.sql
  $PSQL -d "$DB" -1 -f ../migrations/0001_init.sql
}

fresh
$PSQL -d "$DB" -A -t -f owner_isolation.sql | grep -E "PASS|FAIL|^[0-9]+\|[0-9]+$"

echo "-- race: two owner inserts at 4 of 5 (expect one ERROR, 5 questions)"
fresh
$PSQL -d "$DB" -c "insert into auth.users values ('$A'); insert into farms (owner_id) values ('$A');
  insert into custom_questions (farm_id, text) select id, 'Q' || g from farms, generate_series(1, 4) g;"
$PSQL -d "$DB" -c "$OWNER_A" -c "begin; insert into custom_questions (farm_id, text) select id, 'S1' from farms; select pg_sleep(2); commit;" >/dev/null 2>&1 &
sleep 0.5
$PSQL -d "$DB" -c "$OWNER_A" -c "insert into custom_questions (farm_id, text) select id, 'S2' from farms" 2>&1 | grep ERROR || echo "second insert committed"
wait
$PSQL -d "$DB" -A -t -c "select 'questions on Basic farm: ' || count(*) from custom_questions"

echo "-- race: downgrade to Basic at 5 (uncommitted) vs an insert (expect insert ERROR, basic, 5)"
$PSQL -d "$DB" -c "update farms set plan = 'ultimate'"
$PSQL -d "$DB" -c "set role service_role" -c "begin; update farms set plan = 'basic'; select pg_sleep(2); commit;" >/dev/null 2>&1 &
sleep 0.5
$PSQL -d "$DB" -c "$OWNER_A" -c "insert into custom_questions (farm_id, text) select id, 'late' from farms" 2>&1 | grep ERROR || echo "insert committed"
wait
$PSQL -d "$DB" -A -t -c "select 'plan=' || plan || ' questions=' || (select count(*) from custom_questions) from farms"
