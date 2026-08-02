#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repository_dir=$(dirname -- "$script_dir")
cd "$repository_dir"

if [ ! -f .env ] && [ "${CI:-}" != "true" ]; then
  echo "Missing $repository_dir/.env. Copy .env.example and add the staging values first." >&2
  exit 1
fi

mode=${1:-headless}
case "$mode" in
  headless) ;;
  headed)
    export E2E_AUTH_HEADED=true
    export E2E_AUTH_SLOW_MO="${E2E_AUTH_SLOW_MO:-200}"
    ;;
  *)
    echo "Usage: ./scripts/prepare-staging.sh [headless|headed]" >&2
    exit 2
    ;;
esac

echo "Checking staging, seeding the three test accounts, and creating browser sessions..."
exec npm run prepare:staging
