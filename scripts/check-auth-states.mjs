import 'dotenv/config'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { stagingTarget } from './safety.mjs'

const baseUrl = stagingTarget()
const manifestPath = resolve(process.cwd(), process.env.E2E_SEED_MANIFEST || '.auth/staging-users.json')

function fail(message) {
  throw new Error(`${message}; run ./scripts/prepare-staging.sh before the authenticated suite`)
}

if (!existsSync(manifestPath)) fail(`Missing seed manifest ${manifestPath}`)

let manifest
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
} catch {
  fail(`Invalid seed manifest ${manifestPath}`)
}

if (manifest.target !== baseUrl.origin) {
  fail(`Seed manifest targets ${manifest.target || 'an unknown origin'}, expected ${baseUrl.origin}`)
}

const accountKeys = ['memberA', 'memberB', 'newMember']
if (manifest.accounts?.deletionMember) accountKeys.push('deletionMember')
for (const key of accountKeys) {
  const relativeState = manifest.accounts?.[key]?.state
  if (!relativeState) fail(`Seed manifest is missing ${key}`)
  const statePath = resolve(process.cwd(), relativeState)
  if (!existsSync(statePath)) fail(`Missing browser state ${statePath}`)
  let state
  try {
    state = JSON.parse(readFileSync(statePath, 'utf8'))
  } catch {
    fail(`Invalid browser state ${statePath}`)
  }
  const requiredCookies = ['lonely-radish-session']
  if (process.env.E2E_VERCEL_BYPASS_SECRET?.trim()) requiredCookies.push('_vercel_jwt')
  const now = Date.now() / 1000
  for (const name of requiredCookies) {
    const cookie = state.cookies?.find(candidate => candidate.name === name)
    if (!cookie) fail(`Browser state ${statePath} is missing ${name}`)
    if (cookie.expires > 0 && cookie.expires <= now + 60) {
      fail(`Browser state ${statePath} has an expired ${name} cookie`)
    }
  }
}

console.log('Authenticated staging browser states are ready.')
