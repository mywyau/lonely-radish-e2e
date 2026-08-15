import type { Browser, BrowserContext, Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { statePath, type MemberStateName } from './env.js'

export type MemberSession = {
  context: BrowserContext
  page: Page
}

function assertFreshMemberState(path: string) {
  let storage: { cookies?: Array<{ name: string; expires: number }> }
  try {
    storage = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new Error(`Invalid browser state ${path}; run ./scripts/prepare-staging.sh to recreate it`)
  }
  const requiredCookies = ['lonely-radish-session']
  if (process.env.E2E_VERCEL_BYPASS_SECRET?.trim()) requiredCookies.push('_vercel_jwt')
  const now = Date.now() / 1000
  for (const name of requiredCookies) {
    const cookie = storage.cookies?.find(candidate => candidate.name === name)
    if (!cookie || (cookie.expires > 0 && cookie.expires <= now + 60)) {
      throw new Error(`Browser state ${path} has a missing or expired ${name} cookie; run ./scripts/prepare-staging.sh to refresh authenticated sessions`)
    }
  }
}

export async function openMember(
  browser: Browser,
  state: MemberStateName,
): Promise<MemberSession> {
  const memberState = statePath(state)
  assertFreshMemberState(memberState)
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    storageState: memberState,
  })
  return { context, page: await context.newPage() }
}
