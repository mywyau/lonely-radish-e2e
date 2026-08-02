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

for (const key of ['memberA', 'memberB', 'newMember']) {
  const relativeState = manifest.accounts?.[key]?.state
  if (!relativeState) fail(`Seed manifest is missing ${key}`)
  const statePath = resolve(process.cwd(), relativeState)
  if (!existsSync(statePath)) fail(`Missing browser state ${statePath}`)
}

console.log('Authenticated staging browser states are ready.')
