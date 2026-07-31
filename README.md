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

The staging Regular Web Application must use the same database connection and allow the staging callback URL:

```text
https://YOUR-STAGING-HOST/api/auth/callback
```

Choose three dedicated test email addresses that you control. The seed script creates them if absent; it never deletes Auth0 users and never changes an existing account's password.

### E2E safety configuration

Complete `.env`. The important locks are:

```dotenv
E2E_TARGET_ENV=staging
E2E_BASE_URL=https://YOUR-STAGING-HOST
E2E_ALLOWED_HOST=YOUR-STAGING-HOST
E2E_PRODUCTION_URL=https://YOUR-PRODUCTION-HOST

E2E_DATABASE_URL=postgresql://...
E2E_ALLOW_DATABASE_RESET=true
E2E_EXPECTED_DATABASE_HOST=YOUR-EXACT-DATABASE-HOST
E2E_EXPECTED_DATABASE_PROJECT_REF=YOUR-STAGING-SUPABASE-PROJECT-REF
```

Also add the staging Auth0 Management credentials, connection name, one strong test password, and the three test emails shown in `.env.example`.

Four independent checks must agree before anything can write to PostgreSQL: staging environment, application host, database host, and Supabase project reference. The scripts refuse the production application origin.

## Prepare the accounts

After the `staging` branch deployment is ready:

```sh
npm run prepare:staging
```

This performs three idempotent tasks:

1. Verifies staging health, migration state, infrastructure isolation, and public policy pages.
2. Creates or reuses three Auth0 users and seeds two complete dating profiles plus one incomplete onboarding profile.
3. Signs each account in through Auth0 Universal Login and stores reusable browser sessions.

Generated IDs and browser states live under `.auth/`, which is ignored by Git.

## Run the release gate

```sh
npm run test:staging
```

The Chromium gate covers:

- deployment health and staging isolation;
- public pages and the signed-out gate;
- onboarding validation;
- two-account interest, match, unmatch, and rematch behaviour;
- proposal creation with a custom activity and structured public address;
- recipient review, acceptance, and explicit cancellation;
- reporting a profile without being forced to block.

Stripe Checkout is optional because it creates a real test-mode session:

```sh
E2E_RUN_STRIPE_CHECKOUT=true npm run test:staging
```

For local public smoke checks:

```sh
E2E_START_LOCAL_APP=true npm run test:smoke
```

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
