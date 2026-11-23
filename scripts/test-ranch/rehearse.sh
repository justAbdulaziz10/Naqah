#!/bin/sh
# LOCAL ONLY. Rebuilds and rehearses the four-call test-ranch flow with loopback mocks.
set -eu
if [ "$#" -ne 0 ]; then
  echo "Usage: scripts/test-ranch/rehearse.sh" >&2
  exit 2
fi
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$script_dir/rehearse.mjs"
