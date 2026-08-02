import { expect, test } from '@playwright/test'
import { env, hasLifecycleEnvironment } from '../support/env.js'
import { openMember } from '../support/member.js'

test('a member can pause discovery and resume without losing the account', async ({ browser }) => {
  test.skip(!hasLifecycleEnvironment(), 'Run npm run prepare:staging to create the lifecycle accounts')
  const memberA = { slug: env('E2E_MEMBER_A_SLUG') }
  const a = await openMember(browser, 'E2E_MEMBER_A_STATE')
  const b = await openMember(browser, 'E2E_MEMBER_B_STATE')

  try {
    await a.page.goto('/account/controls')
    await a.page.getByLabel('Pause for').selectOption('indefinite')
    await a.page.getByRole('button', { name: 'Pause my profile' }).click()
    await expect(a.page.getByText('Your profile is paused indefinitely.')).toBeVisible()
    expect((await b.page.request.get(`/api/profiles/${memberA.slug}`)).status()).toBe(404)

    await a.page.getByRole('button', { name: 'Resume discovery now' }).click()
    await expect(a.page.getByRole('button', { name: 'Pause my profile' })).toBeVisible()
    expect((await b.page.request.get(`/api/profiles/${memberA.slug}`)).status()).toBe(200)
  } finally {
    await a.page.request.put('/api/account/pause', { data: { choice: 'resume' } }).catch(() => {})
    await Promise.allSettled([a.context.close(), b.context.close()])
  }
})
