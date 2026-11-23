#!/bin/sh
# LOCAL ONLY. Start a private PostgreSQL 17 and recreate the stack for each test case.
set -eu
if [ "${1:-}" != "--clean-env" ]; then
  pg_bin="$(brew --prefix postgresql@17)/bin"
  [ -x "$pg_bin/postgres" ] || { echo "PostgreSQL 17 is required" >&2; exit 1; }
  exec env -i PATH="$pg_bin:$PATH" /bin/sh "$0" --clean-env
fi

cd "$(dirname "$0")/../.."
export LC_ALL=en_US.UTF-8 PGHOST=127.0.0.1 PGUSER=postgres
export NAQAH_TEST_DB=naqah_ranch_isolation NAQAH_TEST_SKIP_CRON_EXTENSIONS=1
export POSTGREST_BIN
POSTGREST_BIN=$(command -v postgrest)
NAQAH_TEST_JWT_SECRET="local-only-$(node -p 'require("node:crypto").randomBytes(32).toString("hex")')"
export NAQAH_TEST_JWT_SECRET

# Keep all three candidate sockets open during selection so each port is distinct.
ports=$(node --input-type=module <<'JS'
import { createServer } from "node:net";
const sockets = [];
for (let port = 55400; port <= 55499 && sockets.length < 3; port++) {
  const server = createServer();
  const available = await new Promise((resolve) => {
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => resolve(true));
  });
  if (available) sockets.push(server);
}
if (sockets.length !== 3) {
  console.error("Three free loopback ports in 55400–55499 are required");
  process.exit(1);
}
console.log(sockets.map((server) => server.address().port).join(" "));
for (const server of sockets) server.close();
JS
)
set -- $ports
export PGPORT="$1" NAQAH_TEST_REST_PORT="$2" NAQAH_TEST_GATEWAY_PORT="$3"

umask 077
scratch=$(mktemp -d /private/tmp/naqah-test-ranch.XXXXXX)
data="$scratch/pg"
stack=""
stop_stack() {
  if [ -n "$stack" ]; then
    kill "$stack" 2>/dev/null || true
    wait "$stack" 2>/dev/null || true
    stack=""
  fi
}
cleanup() {
  stop_stack
  pg_ctl -D "$data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$scratch"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM

initdb -D "$data" -U postgres -A trust -E UTF8 --no-locale >/dev/null
pg_ctl -D "$data" -l "$scratch/postgres.log" -o "-h 127.0.0.1 -p $PGPORT -k ''" -w start >/dev/null
psql -X -Atqc 'show server_version' -d postgres
postgrest --version

# Keep the due-slot fixtures identical across modes, even when the clock passes midnight.
export NAQAH_RANCH_TEST_NOW
NAQAH_RANCH_TEST_NOW=$(node -p 'new Date().toISOString()')
for mode in phases scoped-unfiltered off; do
  echo "Running $mode against a fresh database"
  sh supabase/local-validation/run-stack.sh "$scratch/stack.env" >"$scratch/stack.log" 2>&1 &
  stack=$!
  for attempt in $(seq 1 80); do
    [ -f "$scratch/stack.env" ] && break
    kill -0 "$stack" 2>/dev/null || { cat "$scratch/stack.log" >&2; exit 1; }
    sleep 0.25
  done
  [ -f "$scratch/stack.env" ] || { cat "$scratch/stack.log" >&2; exit 1; }
  (
    . "$scratch/stack.env"
    export NAQAH_RANCH_TEST_MODE="$mode"
    node node_modules/vitest/vitest.mjs run src/server/calls/test-ranch.pg.test.ts --testTimeout=30000
  )
  stop_stack
done
