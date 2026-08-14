# Lonely Radish E2E

Standalone Playwright release checks for Lonely Radish. Public smoke tests can run locally; authenticated and database-changing journeys are locked to the isolated staging deployment.

## One-time setup

```sh
npm install
npm run install:browsers
cp .env.example .env
```

### Staging application

Configure these additional Vercel Preview variables for the `staging` branch:

- `APP_ENV=staging`
- `SITE_URL` and `APP_BASE_URL`: the exact stable staging HTTPS origin
- `STAGING_EMAIL_ALLOWLIST`: the three test-account email addresses, comma-separated

Staging startup refuses a deployment from the wrong Vercel environment/branch, mismatched Supabase URLs and database, or an empty email allowlist. Email addressed to anyone outside the allowlist is recorded as skipped and is never sent. Stripe mode is controlled through the staging branch's Vercel variables rather than inferred from the key prefix.

Use staging-only Auth0, Supabase, Upstash/QStash, Stripe test-mode, and other credentials. Apply database migrations before running the gate.

### Auth0 test-account automation

Create a staging-only Auth0 Machine-to-Machine application and authorise it for the Auth0 Management API with:

- `read:users`
- `create:users`
- `update:users`

The staging Regular Web Application must use the same database connection and allow the staging callback URL. In Auth0, open **Authentication → Database → your `E2E_AUTH0_CONNECTION` → Applications** and enable the staging Regular Web Application:

```text
https://YOUR-STAGING-HOST/api/auth/callback
```

Choose three dedicated test email addresses that you control. The seed script creates them if absent and reconciles existing database-connection test users to `E2E_TEST_PASSWORD`; it never deletes Auth0 users. Do not use personal or production identities.

### E2E safety configuration

Complete `.env`. The important locks are:

```dotenv
E2E_TARGET_ENV=staging
E2E_BASE_URL=https://YOUR-STAGING-HOST
E2E_ALLOWED_HOST=YOUR-STAGING-HOST
E2E_PRODUCTION_URL=https://YOUR-PRODUCTION-HOST

# Required only when Vercel Deployment Protection is enabled.
E2E_VERCEL_BYPASS_SECRET=YOUR-AUTOMATION-BYPASS-SECRET

E2E_DATABASE_URL=postgresql://...
E2E_ALLOW_DATABASE_RESET=true
E2E_EXPECTED_DATABASE_HOST=YOUR-EXACT-DATABASE-HOST
E2E_EXPECTED_DATABASE_PROJECT_REF=YOUR-STAGING-SUPABASE-PROJECT-REF
```

Also add the staging Auth0 Management credentials, connection name, one strong test password, and the three test emails shown in `.env.example`.

Four independent checks must agree before anything can write to PostgreSQL: staging environment, application host, database host, and Supabase project reference. The scripts refuse the production application origin.

If Vercel Deployment Protection is enabled, create a **Protection Bypass for
Automation** secret in the Vercel project and set
`E2E_VERCEL_BYPASS_SECRET`. Account preparation exchanges it for an ignored
browser cookie, so the secret is not attached to requests sent to Auth0.

## Prepare the accounts

After the `staging` branch deployment is ready:

```sh
./scripts/prepare-staging.sh && ./scripts/run-staging-tests.sh
```

Wait for the Vercel deployment and staging migrations to finish before starting
the full gate, and do not deploy again while it is running. The branch URL can
switch to a new deployment mid-run, leaving an already-open browser page with
JavaScript chunk URLs that no longer exist.

To watch Playwright complete the three Auth0 logins, use preparation:

```sh
./scripts/prepare-staging.sh
```

The visible login actions use a short delay. Override it when needed with, for
example, `E2E_AUTH_SLOW_MO=500 ./scripts/prepare-staging.sh`.

This performs three idempotent tasks:

1. Verifies staging health, migration state, infrastructure isolation, and public policy pages.
2. Creates or reuses three Auth0 users and seeds two complete dating profiles plus one incomplete onboarding profile.
3. Signs each account in through Auth0 Universal Login and stores reusable browser sessions.

Generated IDs and browser states live under `.auth/`, which is ignored by Git.

## Run the release gate

```sh
./scripts/run-staging-tests.sh
./scripts/run-staging-tests.sh
./scripts/run-staging-tests.sh ui
```

The Chromium gate covers:

- deployment health and staging isolation;
- public pages and the signed-out gate;
- onboarding validation and complete photo-optional setup;
- two-account interest, “Not for me”, match, closed-connection, and rematch behaviour;
- undo windows for “Not for me”, taking back interest, closing a connection, and a post-date “no”;
- 14-day interest expiry, sender withdrawal, silent notification cleanup, and closed-history labels;
- two-sided age, gender, orientation, and distance eligibility enforcement;
- the five-person received-interest cap, paused intake while full, and immediate reopening after a decision;
- the shared five-connection limit and oldest-eligible queue promotion when a connection closes;
- reciprocal matching that can bypass a full inbox without adding a sixth pending interest;
- free-account active-match limits and clear waiting-match states for both people;
- concurrency protection for the final active slot and repeated activation attempts;
- the five-interest daily allowance and local-day reset;
- concurrent interest attempts that cannot overfill a recipient inbox;
- in-app notification read, bulk-delete, and email-subscription controls;
- proposal creation with a custom activity and structured public address;
- recipient review, acceptance, decline, and explicit cancellation;
- replacement proposals that preserve the confirmed date until accepted;
- private post-date attendance and another-date choices, including mutual, closed, reconsidered, and undone outcomes;
- no-show reporting, dispute and acknowledgement outcomes, timing guards, and private reliability history;
- immediate reporting without being forced to block or entering an undo window;
- immediate blocking, unblocking, and profile visibility restoration;
- pausing and resuming discovery;
- editing gender identity and pronouns, then verifying the private preview and public profile;
- editing bio and lifestyle details, then verifying their persisted private and public presentation;
- replacing activity preferences with listed and custom date ideas;
- grouped sexual-orientation and broad ethnicity preference persistence;
- structured schedule persistence and explicit pre-match availability privacy;
- match-only contact sharing and removal after unmatching;
- cross-account authorization for profiles, contact details, notifications, matches, and date proposals.

Each test has a 90-second emergency ceiling. Assertions still fail after 10
seconds, and focused database or navigation waits retain their shorter limits,
so a stalled operation reports its actual failure instead of waiting for the
full test timeout.

Stripe Checkout is optional because it creates a real test-mode session:

```sh
./scripts/run-staging-tests.sh stripe
```

For local public smoke checks:

```sh
E2E_START_LOCAL_APP=true npm run test:smoke
```

## GitHub Actions release gate

The manual **Staging E2E release gate** workflow uses a protected GitHub
Environment named `staging`. Runs are serialized because the lifecycle tests
reset records shared by the three dedicated test accounts.

In the E2E GitHub repository, create **Settings → Environments → staging** and
add these environment variables:

- `E2E_BASE_URL`
- `E2E_ALLOWED_HOST`
- `E2E_PRODUCTION_URL`
- `E2E_DATABASE_SSL` (`true` unless the staging database requires otherwise)
- `E2E_EXPECTED_DATABASE_HOST`
- `E2E_EXPECTED_DATABASE_PROJECT_REF`
- `E2E_AUTH0_DOMAIN`
- `E2E_AUTH0_CONNECTION`

Add these environment secrets:

- `E2E_DATABASE_URL`
- `E2E_AUTH0_MGMT_CLIENT_ID`
- `E2E_AUTH0_MGMT_CLIENT_SECRET`
- `E2E_TEST_PASSWORD`
- `E2E_MEMBER_A_EMAIL`
- `E2E_MEMBER_B_EMAIL`
- `E2E_NEW_MEMBER_EMAIL`
- `E2E_VERCEL_BYPASS_SECRET` when deployment protection is enabled

The workflow sets the staging and database-reset safety flags itself. It does
not need a checked-in or generated `.env` file.

After the stable staging deployment is ready, open **Actions → Staging E2E
release gate → Run workflow**. Leave **Include the Stripe test-mode Checkout
journey** disabled for the normal release gate, or enable it for an explicit
Stripe verification. Failed runs retain the HTML report, traces, screenshots,
and videos for 14 days.

## Release workflow

1. Create a feature branch from `staging`.
2. Make and locally verify the change.
3. Open/merge a PR from the feature branch into `staging`.
4. Apply any new migrations to staging, wait for the stable staging Preview deployment, then run `npm run prepare:staging` and `npm run test:staging`.
5. If the gate passes, merge `staging` into `main`.
6. Run production migrations as part of the production release process, deploy, and check `/api/health`. Do not run the database-changing Playwright journeys against production.

## Test ownership

- Application repository: unit, component and API tests.
- This repository: browser journeys spanning authentication, multiple accounts, matching, plans, safety and billing handoff.
- Run destructive lifecycle tests against staging/E2E only, never production.
