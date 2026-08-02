import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type Account = { id: string; email: string; name: string; slug: string; state: string }
type Manifest = { version: number; target: string; accounts: { memberA: Account; memberB: Account; newMember: Account } }

function seedManifest(): Manifest | null {
  const path = resolve(process.cwd(), process.env.E2E_SEED_MANIFEST || '.auth/staging-users.json')
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as Manifest
}

const manifestValues: Record<string, () => string | undefined> = {
  E2E_MEMBER_A_ID: () => seedManifest()?.accounts.memberA.id,
  E2E_MEMBER_A_NAME: () => seedManifest()?.accounts.memberA.name,
  E2E_MEMBER_A_SLUG: () => seedManifest()?.accounts.memberA.slug,
  E2E_MEMBER_A_STATE: () => seedManifest()?.accounts.memberA.state,
  E2E_MEMBER_B_ID: () => seedManifest()?.accounts.memberB.id,
  E2E_MEMBER_B_NAME: () => seedManifest()?.accounts.memberB.name,
  E2E_MEMBER_B_SLUG: () => seedManifest()?.accounts.memberB.slug,
  E2E_MEMBER_B_STATE: () => seedManifest()?.accounts.memberB.state,
  E2E_NEW_MEMBER_STATE: () => seedManifest()?.accounts.newMember.state,
}

export function env(name: string): string {
  const value = process.env[name]?.trim() || manifestValues[name]?.()
  if (!value) throw new Error(`${name} is required for this test`)
  return value
}

export function statePath(name: 'E2E_MEMBER_A_STATE' | 'E2E_MEMBER_B_STATE' | 'E2E_NEW_MEMBER_STATE'): string {
  const path = resolve(process.cwd(), env(name))
  if (!existsSync(path)) throw new Error(`${name} does not exist at ${path}`)
  return path
}

export function optionalStatePath(
  name: 'E2E_MEMBER_A_STATE' | 'E2E_MEMBER_B_STATE' | 'E2E_NEW_MEMBER_STATE',
): string | null {
  try {
    return statePath(name)
  } catch {
    return null
  }
}

export function hasLifecycleEnvironment(): boolean {
  const valuesReady = [
    'E2E_DATABASE_URL',
    'E2E_MEMBER_A_STATE',
    'E2E_MEMBER_B_STATE',
    'E2E_MEMBER_A_ID',
    'E2E_MEMBER_A_NAME',
    'E2E_MEMBER_A_SLUG',
    'E2E_MEMBER_B_ID',
    'E2E_MEMBER_B_NAME',
    'E2E_MEMBER_B_SLUG',
  ].every(name => {
    try {
      return Boolean(env(name))
    } catch {
      return false
    }
  })
  if (!valuesReady) return false
  try {
    statePath('E2E_MEMBER_A_STATE')
    statePath('E2E_MEMBER_B_STATE')
    return true
  } catch {
    return false
  }
}

export function assertStagingDatabaseTarget(): void {
  if (env('E2E_TARGET_ENV') !== 'staging') throw new Error('E2E_TARGET_ENV must be exactly staging')
  if (process.env.E2E_ALLOW_DATABASE_RESET !== 'true') {
    throw new Error('E2E_ALLOW_DATABASE_RESET must be exactly true')
  }
  const target = new URL(env('E2E_BASE_URL'))
  if (target.protocol !== 'https:' || target.hostname !== env('E2E_ALLOWED_HOST')) {
    throw new Error('E2E staging host lock does not match E2E_BASE_URL')
  }
  const production = process.env.E2E_PRODUCTION_URL?.trim()
  if (production && new URL(production).origin === target.origin) {
    throw new Error('Refusing database reset against the production application target')
  }
  const database = new URL(env('E2E_DATABASE_URL'))
  if (database.hostname !== env('E2E_EXPECTED_DATABASE_HOST')) {
    throw new Error('E2E database host lock does not match E2E_DATABASE_URL')
  }
  const directRef = database.hostname.match(/^db\.([a-z0-9-]+)\.supabase\.co$/i)?.[1]
  const pooledRef = decodeURIComponent(database.username).match(/^postgres\.([a-z0-9-]+)$/i)?.[1]
  if ((directRef || pooledRef)?.toLowerCase() !== env('E2E_EXPECTED_DATABASE_PROJECT_REF').toLowerCase()) {
    throw new Error('E2E database project lock does not match E2E_DATABASE_URL')
  }
}
