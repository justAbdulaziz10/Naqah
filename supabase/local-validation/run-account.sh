#!/bin/sh
# LOCAL ONLY. Disposable Postgres 15+, bootstrap roles, then every reviewed migration.
# PGHOST=127.0.0.1 PGPORT=54359 PGUSER=postgres sh supabase/local-validation/run-account.sh
set -eu
cd "$(dirname "$0")"
DB="${NAQAH_TEST_DB:-naqah_account_test}"
case "$DB" in
  ""|[!A-Za-z_]*|*[!A-Za-z0-9_]*) echo "Refusing unsafe database name" >&2; exit 2 ;;
esac
PGHOST="${PGHOST:-127.0.0.1}"
for host in "$PGHOST" "${PGHOSTADDR:-}"; do
  case "$host" in ""|localhost|127.*|::1) ;; *) echo "Refusing non-loopback PostgreSQL host" >&2; exit 2 ;; esac
done
export PGHOST
PSQL="psql -X -q -v ON_ERROR_STOP=1"
SERVER_ADDR=$($PSQL -d postgres -A -t -c "select inet_server_addr()::text")
case "$SERVER_ADDR" in 127.*|::1) ;; *) echo "Refusing non-local PostgreSQL server" >&2; exit 2 ;; esac
$PSQL -d postgres -c "drop database if exists $DB"
$PSQL -d postgres -c "create database $DB"
$PSQL -d "$DB" -f bootstrap.sql
for migration in ../migrations/*.sql; do $PSQL -d "$DB" -1 -f "$migration"; done
$PSQL -d "$DB" -f plan_selection.sql
cd ../..
NAQAH_TEST_DB="$DB" npx vitest run src/server/db/custom-question.pg.test.ts
