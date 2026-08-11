import 'dotenv/config'
import { defineConfig, devices } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const vercelBypassSecret = process.env.E2E_VERCEL_BYPASS_SECRET?.trim()
const vercelBypassState = process.env.E2E_VERCEL_BYPASS_STATE || '.auth/vercel-bypass.json'
if (vercelBypassSecret) {
  const bypassPath = resolve(process.cwd(), vercelBypassState)
  if (!existsSync(bypassPath)) {
    throw new Error(`Missing ${vercelBypassState}; run ./scripts/prepare-staging.sh to create the Vercel bypass state`)
  }
  let bypassState: { cookies?: Array<{ name: string; expires: number }> }
  try {
    bypassState = JSON.parse(readFileSync(bypassPath, 'utf8'))
  } catch {
    throw new Error(`Invalid ${vercelBypassState}; run ./scripts/prepare-staging.sh to recreate it`)
  }
  const bypassCookie = bypassState.cookies?.find(cookie => cookie.name === '_vercel_jwt')
  const expiresSoon = !bypassCookie ||
    (bypassCookie.expires > 0 && bypassCookie.expires <= Date.now() / 1000 + 60)
  if (expiresSoon) {
    throw new Error(`Expired Vercel bypass state ${vercelBypassState}; run ./scripts/prepare-staging.sh to refresh it`)
  }
}

export default defineConfig({
  testDir: './tests',
  fullyParallel: process.env.E2E_TARGET_ENV !== 'staging',
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.E2E_TARGET_ENV === 'staging' ? 1 : process.env.CI ? 2 : undefined,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [['line'], ['html', { open: 'never' }], ['junit', { outputFile: 'test-results/junit.xml' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    storageState: vercelBypassSecret ? vercelBypassState : undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chrome', testMatch: /mobile\/.*\.spec\.ts/, use: { ...devices['Pixel 7'] } },
  ],
  webServer: process.env.E2E_START_LOCAL_APP === 'true' ? {
    command: 'npm run dev --prefix ../lonely-radish-frontend',
    url: process.env.E2E_BASE_URL || 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  } : undefined,
  outputDir: 'test-results/artifacts',
})
