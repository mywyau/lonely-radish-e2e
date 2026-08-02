import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { chromium, request } from '@playwright/test'
import { required, stagingTarget } from './safety.mjs'

const baseUrl = stagingTarget()
const password = required('E2E_TEST_PASSWORD')
const auth0Domain = required('E2E_AUTH0_DOMAIN').replace(/^https?:\/\//, '').replace(/\/+$/, '')
const auth0Connection = required('E2E_AUTH0_CONNECTION')
const manifestPath = resolve(process.cwd(), process.env.E2E_SEED_MANIFEST || '.auth/staging-users.json')
const vercelBypassSecret = process.env.E2E_VERCEL_BYPASS_SECRET?.trim()
const vercelBypassStatePath = resolve(
  process.cwd(),
  process.env.E2E_VERCEL_BYPASS_STATE || '.auth/vercel-bypass.json',
)
const authHeaded = process.env.E2E_AUTH_HEADED === 'true'
const configuredSlowMo = Number(process.env.E2E_AUTH_SLOW_MO || 0)
const authSlowMo = Number.isFinite(configuredSlowMo) && configuredSlowMo >= 0 ? configuredSlowMo : 0
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
if (manifest.target !== baseUrl.origin) {
  throw new Error(`Seed manifest targets ${manifest.target}; expected ${baseUrl.origin}`)
}

async function createVercelBypassState() {
  if (!vercelBypassSecret) return undefined

  await mkdir(dirname(vercelBypassStatePath), { recursive: true })
  const api = await request.newContext()
  try {
    const bypassUrl = new URL('/', baseUrl)
    bypassUrl.searchParams.set('x-vercel-protection-bypass', vercelBypassSecret)
    bypassUrl.searchParams.set('x-vercel-set-bypass-cookie', 'true')
    const response = await api.get(bypassUrl.toString())
    if (!response.ok()) {
      throw new Error(`Vercel Deployment Protection bypass returned HTTP ${response.status()}`)
    }

    const state = await api.storageState()
    const hasBypassCookie = state.cookies.some(cookie =>
      cookie.name === '_vercel_jwt' && baseUrl.hostname.endsWith(cookie.domain.replace(/^\./, '')),
    )
    if (!hasBypassCookie) {
      throw new Error('Vercel accepted the request but did not issue a bypass cookie')
    }
    await api.storageState({ path: vercelBypassStatePath })
    console.log('Created Vercel Deployment Protection browser state')
    return vercelBypassStatePath
  } finally {
    await api.dispose()
  }
}

const initialStorageState = await createVercelBypassState()

async function submitFormFor(field) {
  const form = field.locator('xpath=ancestor::form[1]')
  const submit = form.locator([
    'button[type="submit"]:not([aria-hidden="true"]):visible',
    'input[type="submit"]:not([aria-hidden="true"]):visible',
  ].join(', ')).last()
  await submit.waitFor({ state: 'visible', timeout: 20_000 })
  await submit.click()
}

async function signIn(accountKey, account) {
  const statePath = resolve(process.cwd(), account.state)
  await mkdir(dirname(statePath), { recursive: true })
  const browser = await chromium.launch({ headless: !authHeaded, slowMo: authSlowMo })
  const context = await browser.newContext({ storageState: initialStorageState })
  const page = await context.newPage()
  try {
    console.log(`Signing in ${account.name}...`)
    const loginUrl = new URL('/api/auth/login?mode=switch&returnTo=/matches', baseUrl)
    const loginResponse = await context.request.get(loginUrl.toString(), { maxRedirects: 0 })
    if (![301, 302, 303, 307, 308].includes(loginResponse.status())) {
      throw new Error(`Application login initiation returned HTTP ${loginResponse.status()}`)
    }
    const location = loginResponse.headers().location
    if (!location) throw new Error('Application login initiation did not return an Auth0 redirect')
    const authorizeUrl = new URL(location)
    if (authorizeUrl.hostname !== auth0Domain) {
      throw new Error(`Application login redirected to unexpected identity host ${authorizeUrl.hostname}`)
    }
    authorizeUrl.searchParams.set('connection', auth0Connection)
    await page.goto(authorizeUrl.toString())
    if (new URL(page.url()).origin === baseUrl.origin) {
      const applicationError = await page.locator('body').innerText().catch(() => '')
      if (/connection is not enabled/i.test(applicationError)) {
        throw new Error(`Auth0 database connection "${auth0Connection}" is not enabled for the staging Regular Web Application. Enable that connection for the application in Auth0, then run preparation again.`)
      }
    }
    const identity = page.locator([
      'input[name="username"]:visible',
      'input[name="email"]:visible',
      'input[type="email"]:visible',
    ].join(', ')).first()
    await identity.waitFor({ state: 'visible', timeout: 20_000 })
    await identity.fill(account.email)
    console.log(`Entered the identity for ${account.name}`)

    let passwordInput = page.locator('input[name="password"]:visible, input[type="password"]:visible').first()
    if (!await passwordInput.isVisible()) {
      await submitFormFor(identity)
      passwordInput = page.locator('input[name="password"]:visible, input[type="password"]:visible').first()
      await passwordInput.waitFor({ state: 'visible', timeout: 20_000 })
    }
    console.log(`Password form ready for ${account.name}`)
    await passwordInput.fill(password)
    await submitFormFor(passwordInput)
    const rejectedCredentials = page.getByText(/wrong email or password/i).first()
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => { throw new Error(`Auth0 rejected the credentials for ${account.name}. Use a dedicated test address or recreate the synthetic Auth0 user with E2E_TEST_PASSWORD.`) })
    await Promise.race([
      page.waitForURL(url => url.origin === baseUrl.origin && !url.pathname.startsWith('/api/auth/'), {
        timeout: 30_000,
      }),
      rejectedCredentials,
    ])
    if (page.url().includes('/please-sign-in') || page.url().includes('/auth/error')) {
      throw new Error(`Authentication did not create an application session for ${account.email}`)
    }
    await context.storageState({ path: statePath })
    console.log(`Created browser session for ${account.name}`)
  } catch (error) {
    const diagnosticPath = resolve(process.cwd(), `.auth/login-failure-${accountKey}.png`)
    await page.screenshot({ path: diagnosticPath, fullPage: true }).catch(() => undefined)
    console.error(`Auth0 login failed for ${account.name} on ${new URL(page.url()).hostname}. Screenshot: ${diagnosticPath}`)
    throw error
  } finally {
    await context.close()
    await browser.close()
  }
}

for (const [accountKey, account] of Object.entries(manifest.accounts)) await signIn(accountKey, account)
