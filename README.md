# Lonely Radish E2E

Standalone Playwright tests for cross-account journeys against a local or isolated staging deployment.

## Setup

```sh
npm install
npm run install:browsers
cp .env.example .env
```

Create dedicated Auth0 test accounts, complete their profiles, and save an authenticated browser state for each:

```sh
npx playwright codegen --save-storage=.auth/member-a.json http://localhost:3000
npx playwright codegen --save-storage=.auth/member-b.json http://localhost:3000
```

Sign in manually in each codegen window, then close it. Never commit `.auth/` files.

Set the accounts' Auth0 subject IDs, display names and profile slugs in `.env`. Point `E2E_DATABASE_URL` only at an isolated E2E database and set:

```sh
E2E_ALLOW_DATABASE_RESET=true
```

The reset helper only deletes relationship data between the two configured test accounts. It refuses to run without the explicit reset flag.

## Run

```sh
npm test
npm run test:headed
npm run test:ui
```

Start the application separately, or let Playwright start the neighbouring frontend checkout:

```sh
E2E_START_LOCAL_APP=true npm run test:smoke
```

Smoke tests run without authenticated states. Account lifecycle tests skip until their required environment is configured.

## Test ownership

- Application repository: unit, component and API tests.
- This repository: browser journeys spanning authentication, multiple accounts, matching, dates, offers and business redemption.
- Run destructive lifecycle tests against staging/E2E only, never production.
