import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import {
  clearDailyInterestLimitFixtures,
  configureEligibilityScenario,
  moveDailyInterestsToPreviousDay,
  resetRelationshipPair,
  seedDailyInterestLimit,
} from '../support/database.js'
import { env, hasLifecycleEnvironment } from '../support/env.js'
import { openMember } from '../support/member.js'

test('the five-interest daily allowance resets on the member’s next local day', async ({ browser }) => {
  test.skip(!hasLifecycleEnvironment(), 'Run npm run prepare:staging to create the lifecycle accounts')
  test.setTimeout(90_000)
  const memberA = { id: env('E2E_MEMBER_A_ID') }
  const memberB = { id: env('E2E_MEMBER_B_ID'), slug: env('E2E_MEMBER_B_SLUG') }
  await resetRelationshipPair(memberA.id, memberB.id)
  await clearDailyInterestLimitFixtures(memberA.id)
  await configureEligibilityScenario(memberA.id, memberB.id, 'compatible')
  await seedDailyInterestLimit(memberA.id)
  const a = await openMember(browser, 'E2E_MEMBER_A_STATE')

  try {
    await test.step('five interests prevent a sixth on the same local day', async () => {
      await a.page.goto(`/profiles/${memberB.slug}`)
      await expect(a.page.getByText(/You have sent your 5 interests for today/)).toBeVisible()
      const response = await a.page.request.post('/api/interests', {
        data: { profileSlug: memberB.slug },
        headers: { 'Idempotency-Key': randomUUID() },
      })
      expect(response.status()).toBe(409)
      expect((await response.json()).statusMessage).toBe('You have reached today’s limit of 5 interests')
    })

    await test.step('the next local day restores the allowance', async () => {
      await moveDailyInterestsToPreviousDay(memberA.id)
      await a.page.reload()
      const responsePromise = a.page.waitForResponse(response =>
        response.url().includes('/api/interests') && response.request().method() === 'POST')
      a.page.once('dialog', dialog => dialog.accept())
      await a.page.getByRole('button', { name: /^Show interest/i }).click()
      expect((await responsePromise).ok()).toBe(true)
      await expect(a.page.getByText(/Interest sent to/i)).toBeVisible()
    })
  } finally {
    await Promise.allSettled([a.context.close()])
    await resetRelationshipPair(memberA.id, memberB.id)
    await clearDailyInterestLimitFixtures(memberA.id)
    await configureEligibilityScenario(memberA.id, memberB.id, 'compatible')
  }
})
