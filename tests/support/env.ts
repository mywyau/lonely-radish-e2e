import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

export function env(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required for this test`)
  return value
}

export function statePath(name: 'E2E_MEMBER_A_STATE' | 'E2E_MEMBER_B_STATE' | 'E2E_NEW_MEMBER_STATE'): string {
  const path = resolve(process.cwd(), env(name))
  if (!existsSync(path)) throw new Error(`${name} does not exist at ${path}`)
  return path
}

export function hasLifecycleEnvironment(): boolean {
  return [
    'E2E_DATABASE_URL',
    'E2E_MEMBER_A_STATE',
    'E2E_MEMBER_B_STATE',
    'E2E_MEMBER_A_ID',
    'E2E_MEMBER_A_NAME',
    'E2E_MEMBER_A_SLUG',
    'E2E_MEMBER_B_ID',
    'E2E_MEMBER_B_NAME',
    'E2E_MEMBER_B_SLUG',
  ].every(name => Boolean(process.env[name]?.trim()))
}
