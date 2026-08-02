#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repository_dir=$(dirname -- "$script_dir")
cd "$repository_dir"

if [ ! -f .env ]; then
  echo "Missing $repository_dir/.env. Copy .env.example and add the staging values first." >&2
  exit 1
fi

mode=${1:-test}
if [ "$#" -gt 0 ]; then shift; fi

case "$mode" in
  test)
    npm run check:staging
    npm run check:auth
    exec npx playwright test --project=chromium "$@"
    ;;
  smoke)
    npm run check:staging
    exec npx playwright test --project=chromium tests/smoke tests/staging "$@"
    ;;
  headed)
    npm run check:staging
    npm run check:auth
    exec npx playwright test --project=chromium --headed "$@"
    ;;
  ui)
    npm run check:staging
    npm run check:auth
    exec npx playwright test --project=chromium --ui "$@"
    ;;
  stripe)
    export E2E_RUN_STRIPE_CHECKOUT=true
    npm run check:staging
    npm run check:auth
    exec npx playwright test --project=chromium "$@"
    ;;
  *)
    echo "Usage: ./scripts/run-staging-tests.sh [test|smoke|headed|ui|stripe] [playwright arguments...]" >&2
    exit 2
    ;;
esac
