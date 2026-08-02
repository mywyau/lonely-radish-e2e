import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import {
  clearInterestInboxFixtures,
  reopenInterestInbox,
  resetRelationshipPair,
  seedFullInterestInbox,
} from '../support/database.js'
import { env, hasLifecycleEnvironment } from '../support/env.js'
import { openMember } from '../support/member.js'

test('a full interest inbox pauses new interest until the next review', async ({ browser }) => {
  test.skip(!hasLifecycleEnvironment(), 'Run npm run prepare:staging to create the lifecycle accounts')
  test.setTimeout(90_000)
  const memberA = { id: env('E2E_MEMBER_A_ID'), name: env('E2E_MEMBER_A_NAME') }
  const memberB = { id: env('E2E_MEMBER_B_ID'), slug: env('E2E_MEMBER_B_SLUG') }
  await resetRelationshipPair(memberA.id, memberB.id)
  await clearInterestInboxFixtures(memberB.id)
  const fixtureNames = await seedFullInterestInbox(memberB.id)
  const a = await openMember(browser, 'E2E_MEMBER_A_STATE')
  const b = await openMember(browser, 'E2E_MEMBER_B_STATE')

  async function attemptInterest() {
    return a.page.request.post('/api/interests', {
      data: { profileSlug: memberB.slug },
      headers: { 'Idempotency-Key': randomUUID() },
    })
  }

  try {
    await test.step('the recipient sees only the five current interests', async () => {
      await b.page.goto('/interests/received')
      await expect(b.page.getByText('5 of 5 current interests')).toBeVisible()
      await expect(b.page.locator('article')).toHaveCount(5)
      for (const name of fixtureNames) {
        await expect(b.page.locator('article').filter({ hasText: name })).toBeVisible()
      }
    })

    await test.step('a sixth non-reciprocal interest is refused', async () => {
      const response = await attemptInterest()
      expect(response.status()).toBe(409)
      expect((await response.json()).statusMessage)
        .toBe('This person is not accepting new interests right now')
    })

    await test.step('passing does not immediately replace the reviewed person', async () => {
      const card = b.page.locator('article').filter({ hasText: fixtureNames[0] }).first()
      const dialogPromise = b.page.waitForEvent('dialog')
      const clickPromise = card.getByRole('button', { name: 'Pass' }).click()
      const dialog = await dialogPromise
      await dialog.accept()
      await clickPromise
      await expect(card).toBeHidden()
      await b.page.reload()
      await expect(b.page.locator('article')).toHaveCount(4)
      await expect(b.page.locator('article').filter({ hasText: memberA.name })).toHaveCount(0)

      const response = await attemptInterest()
      expect(response.status()).toBe(409)
      expect((await response.json()).statusMessage)
        .toBe('This person is not accepting new interests right now')
    })

    await test.step('the next review window makes the open place available', async () => {
      await reopenInterestInbox(memberB.id)
      const response = await attemptInterest()
      expect(response.ok()).toBe(true)
      await b.page.reload()
      await expect(b.page.getByText('5 of 5 current interests')).toBeVisible()
      await expect(b.page.locator('article').filter({ hasText: memberA.name })).toBeVisible()
    })
  } finally {
    await Promise.allSettled([a.context.close(), b.context.close()])
    await resetRelationshipPair(memberA.id, memberB.id)
    await clearInterestInboxFixtures(memberB.id)
  }
})
