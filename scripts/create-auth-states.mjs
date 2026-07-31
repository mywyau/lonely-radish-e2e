import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { required, stagingTarget } from './safety.mjs'

const baseUrl = stagingTarget()
const password = required('E2E_TEST_PASSWORD')
const manifestPath = resolve(process.cwd(), process.env.E2E_SEED_MANIFEST || '.auth/staging-users.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
if (manifest.target !== baseUrl.origin) {
  throw new Error(`Seed manifest targets ${manifest.target}; expected ${baseUrl.origin}`)
}

async function signIn(account) {
  const statePath = resolve(process.cwd(), account.state)
  await mkdir(dirname(statePath), { recursive: true })
  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    await page.goto(new URL('/api/auth/login?mode=switch&returnTo=/matches', baseUrl).toString())
    const identity = page.locator('input[name="username"], input[name="email"], input[type="email"]').first()
    await identity.waitFor({ state: 'visible', timeout: 20_000 })
    await identity.fill(account.email)

    let passwordInput = page.locator('input[name="password"], input[type="password"]').first()
    if (!await passwordInput.isVisible()) {
      await page.locator('button[type="submit"], input[type="submit"]').first().click()
      passwordInput = page.locator('input[name="password"], input[type="password"]').first()
      await passwordInput.waitFor({ state: 'visible', timeout: 20_000 })
    }
    await passwordInput.fill(password)
    await page.locator('button[type="submit"], input[type="submit"]').first().click()
    await page.waitForURL(url => url.origin === baseUrl.origin && !url.pathname.startsWith('/api/auth/'), {
      timeout: 30_000,
    })
    if (page.url().includes('/please-sign-in') || page.url().includes('/auth/error')) {
      throw new Error(`Authentication did not create an application session for ${account.email}`)
    }
    await context.storageState({ path: statePath })
    console.log(`Created browser session for ${account.name}`)
  } finally {
    await context.close()
    await browser.close()
  }
}

for (const account of Object.values(manifest.accounts)) await signIn(account)
