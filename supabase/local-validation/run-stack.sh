#!/bin/sh
# LOCAL ONLY. Runs a Supabase-like stack for browser and server tests without docker or the Supabase CLI:
# a throwaway database with every migration, real PostgREST, and mock-gateway.mjs for the API gateway and
# Auth. Needs a disposable local Postgres 15+ through the usual PG* variables (TCP, not a socket), psql,
# and a PostgREST binary in POSTGREST_BIN. Never point this at a real project.
#
#   sh supabase/local-validation/run-stack.sh /tmp/naqah-live-tools/stack.env
#
# Writes export lines to the given file once everything is ready, then stays in the foreground until
# killed. The file disappears again on exit, so its existence means the stack is up.
set -eu
[ $# -eq 1 ] && [ -n "$1" ] || { echo "Usage: $0 <env-output-file>" >&2; exit 2; }
ENV_FILE="$1"
case "$ENV_FILE" in /*) ;; *) ENV_FILE="$PWD/$ENV_FILE" ;; esac
cd "$(dirname "$0")"
DB="${NAQAH_TEST_DB:-naqah_live}"
REST_PORT="${NAQAH_TEST_REST_PORT:-54351}"
GATEWAY_PORT="${NAQAH_TEST_GATEWAY_PORT:-54352}"
POSTGREST_BIN="${POSTGREST_BIN:-/tmp/naqah-live-tools/rest/postgrest}"
SECRET="${NAQAH_TEST_JWT_SECRET:-local-only-jwt-secret-for-live-stack-validation}"
PSQL="psql -X -q -v ON_ERROR_STOP=1"

case "$SECRET" in
  local-only-*) ;;
  *) echo 'Refusing a JWT secret that does not start with "local-only-"' >&2; exit 2 ;;
esac

# This script drops and recreates DB. Refuse remote PostgreSQL connections before running SQL.
case "$DB" in
  ""|[!A-Za-z_]*|*[!A-Za-z0-9_]*) echo "Refusing unsafe database name: $DB" >&2; exit 2 ;;
esac
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-54350}"
PGUSER="${PGUSER:-postgres}"
NAQAH_TEST_PGHOST="${NAQAH_TEST_PGHOST:-$PGHOST}"
for host in "$PGHOST" "${PGHOSTADDR:-}" "$NAQAH_TEST_PGHOST"; do
  case "$host" in
    ""|localhost|127.*|::1) ;;
    *) echo "Refusing non-loopback PostgreSQL host: $host" >&2; exit 2 ;;
  esac
done
export PGHOST PGPORT PGUSER

SERVER_ADDR=$($PSQL -d postgres -A -t -c "select inet_server_addr()::text")
case "$SERVER_ADDR" in
  127.*|::1) ;;
  *) echo "Refusing non-local PostgreSQL server: $SERVER_ADDR" >&2; exit 2 ;;
esac

for port in "$REST_PORT" "$GATEWAY_PORT"; do
  if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$port/"; then
    echo "Port $port is already in use. Stop the old stack first." >&2
    exit 1
  fi
done

rm -f "$ENV_FILE"
$PSQL -d postgres -c "drop database if exists $DB with (force)"
$PSQL -d postgres -c "create database $DB"
$PSQL -d "$DB" -f bootstrap.sql
for migration in ../migrations/*.sql; do $PSQL -d "$DB" -1 -f "$migration"; done
$PSQL -d "$DB" -c "do \$\$ begin create role authenticator login noinherit; exception when duplicate_object then null; end \$\$" \
  -c "grant anon, authenticated, service_role to authenticator"

REST=""
GATEWAY=""
cleanup() {
  trap - EXIT INT TERM
  rm -f "$ENV_FILE" "$ENV_FILE.tmp"
  for pid in $GATEWAY $REST; do kill "$pid" 2>/dev/null || true; done
  for pid in $GATEWAY $REST; do wait "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

PGRST_DB_URI="postgres://authenticator@${NAQAH_TEST_PGHOST}:${PGPORT}/$DB" \
PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon PGRST_JWT_SECRET="$SECRET" \
PGRST_SERVER_PORT="$REST_PORT" PGRST_SERVER_HOST=127.0.0.1 PGRST_LOG_LEVEL=crit \
"$POSTGREST_BIN" &
REST=$!

NAQAH_TEST_DB="$DB" NAQAH_TEST_POSTGREST="http://127.0.0.1:$REST_PORT" NAQAH_TEST_JWT_SECRET="$SECRET" \
NAQAH_TEST_GATEWAY_PORT="$GATEWAY_PORT" node mock-gateway.mjs &
GATEWAY=$!

wait_for() {
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40; do
    kill -0 "$2" 2>/dev/null || { echo "$3 exited during startup" >&2; exit 1; }
    curl -s -o /dev/null --max-time 2 "$1" && return 0
    sleep 0.25
  done
  echo "$3 did not start in time" >&2
  exit 1
}
wait_for "http://127.0.0.1:$REST_PORT/" "$REST" PostgREST
wait_for "http://127.0.0.1:$GATEWAY_PORT/auth/v1/.well-known/jwks.json" "$GATEWAY" Gateway

ANON_KEY=$(NAQAH_TEST_JWT_SECRET="$SECRET" node mock-gateway.mjs mint anon)
SERVICE_KEY=$(NAQAH_TEST_JWT_SECRET="$SECRET" node mock-gateway.mjs mint service_role)
cat > "$ENV_FILE.tmp" <<EOF
export NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:$GATEWAY_PORT'
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='$ANON_KEY'
export SUPABASE_SECRET_KEY='$SERVICE_KEY'
EOF
mv "$ENV_FILE.tmp" "$ENV_FILE"
echo "Stack ready: http://127.0.0.1:$GATEWAY_PORT (env in $ENV_FILE)"

while kill -0 "$REST" 2>/dev/null && kill -0 "$GATEWAY" 2>/dev/null; do sleep 1; done
echo "A stack process exited" >&2
exit 1
