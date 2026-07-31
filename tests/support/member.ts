import type { Browser, BrowserContext, Page } from '@playwright/test'
import { statePath } from './env.js'

export type MemberSession = {
  context: BrowserContext
  page: Page
}

export async function openMember(
  browser: Browser,
  state: 'E2E_MEMBER_A_STATE' | 'E2E_MEMBER_B_STATE' | 'E2E_NEW_MEMBER_STATE',
): Promise<MemberSession> {
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    storageState: statePath(state),
  })
  return { context, page: await context.newPage() }
}
