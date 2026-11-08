#!/bin/sh
# LOCAL ONLY. Proves the phone line end to end without Twilio or a Supabase project: mocked, signed
# webhooks enter the real route handlers, then real supabase-js, real PostgREST and all migrations
# on a throwaway Postgres. Needs a disposable local Postgres 15+ through the usual PG* variables
# (TCP, not a socket) and a PostgREST binary in POSTGREST_BIN. Never point this at a real project.
set -eu
cd "$(dirname "$0")"
DB="${NAQAH_TEST_DB:-naqah_voice}"
REST_PORT="${NAQAH_TEST_REST_PORT:-54341}"
SECRET="local-only-jwt-secret-for-voice-validation"
PSQL="psql -X -q -v ON_ERROR_STOP=1"

# This script drops and recreates DB. Refuse remote PostgreSQL connections before running SQL.
case "$DB" in
  ""|[!A-Za-z_]*|*[!A-Za-z0-9_]*) echo "Refusing unsafe database name: $DB" >&2; exit 2 ;;
esac
PGHOST="${PGHOST:-127.0.0.1}"
NAQAH_TEST_PGHOST="${NAQAH_TEST_PGHOST:-$PGHOST}"
for host in "$PGHOST" "${PGHOSTADDR:-}" "$NAQAH_TEST_PGHOST"; do
  case "$host" in
    ""|localhost|127.*|::1) ;;
    *) echo "Refusing non-loopback PostgreSQL host: $host" >&2; exit 2 ;;
  esac
done
export PGHOST

SERVER_ADDR=$($PSQL -d postgres -A -t -c "select inet_server_addr()::text")
case "$SERVER_ADDR" in
  127.*|::1) ;;
  *) echo "Refusing non-local PostgreSQL server: $SERVER_ADDR" >&2; exit 2 ;;
esac

$PSQL -d postgres -c "drop database if exists $DB with (force)"
$PSQL -d postgres -c "create database $DB"
$PSQL -d "$DB" -f bootstrap.sql
for migration in ../migrations/*.sql; do $PSQL -d "$DB" -1 -f "$migration"; done
$PSQL -d "$DB" -c "do \$\$ begin create role authenticator login noinherit; exception when duplicate_object then null; end \$\$" \
  -c "grant anon, authenticated, service_role to authenticator"

PGRST_DB_URI="postgres://authenticator@${NAQAH_TEST_PGHOST}:${PGPORT:-5432}/$DB" \
PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon PGRST_JWT_SECRET="$SECRET" \
PGRST_SERVER_PORT="$REST_PORT" PGRST_SERVER_HOST=127.0.0.1 PGRST_LOG_LEVEL=crit \
"${POSTGREST_BIN:-postgrest}" &
REST=$!
trap 'kill $REST 2>/dev/null || true' EXIT
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  curl -s -o /dev/null "http://127.0.0.1:$REST_PORT/" && break
  sleep 0.25
done

cd ../..
NAQAH_TEST_DB="$DB" NAQAH_TEST_POSTGREST="http://127.0.0.1:$REST_PORT" NAQAH_TEST_JWT_SECRET="$SECRET" \
  npx vitest run src/server/voice/farm-call.pg.test.ts
