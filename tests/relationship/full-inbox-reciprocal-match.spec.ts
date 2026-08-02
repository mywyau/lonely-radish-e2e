import { expect, test, type Page } from '@playwright/test'
import {
  clearInterestInboxFixtures,
  configureEligibilityScenario,
  resetRelationshipPair,
  seedFullInterestInbox,
} from '../support/database.js'
import { env, hasLifecycleEnvironment } from '../support/env.js'
import { openMember } from '../support/member.js'

test('a full inbox still allows an existing interest to become a mutual match', async ({ browser }) => {
  test.skip(!hasLifecycleEnvironment(), 'Run npm run prepare:staging to create the lifecycle accounts')
  test.setTimeout(90_000)
  const memberA = {
    id: env('E2E_MEMBER_A_ID'),
    name: env('E2E_MEMBER_A_NAME'),
    slug: env('E2E_MEMBER_A_SLUG'),
  }
  const memberB = {
    id: env('E2E_MEMBER_B_ID'),
    name: env('E2E_MEMBER_B_NAME'),
    slug: env('E2E_MEMBER_B_SLUG'),
  }
  await resetRelationshipPair(memberA.id, memberB.id)
  await clearInterestInboxFixtures(memberA.id)
  await configureEligibilityScenario(memberA.id, memberB.id, 'compatible')
  const a = await openMember(browser, 'E2E_MEMBER_A_STATE')
  const b = await openMember(browser, 'E2E_MEMBER_B_STATE')

  async function sendInterest(page: Page, slug: string) {
    await page.goto(`/profiles/${slug}`)
    const responsePromise = page.waitForResponse(response =>
      response.url().includes('/api/interests') && response.request().method() === 'POST')
    page.once('dialog', dialog => dialog.accept())
    await page.getByRole('button', { name: /^Show interest/i }).click()
    return responsePromise
  }

  try {
    const first = await sendInterest(a.page, memberB.slug)
    expect(first.ok()).toBe(true)
    expect((await first.json()).matched).toBe(false)

    await seedFullInterestInbox(memberA.id)
    await a.page.goto('/interests/received')
    await expect(a.page.getByText('5 of 5 current interests')).toBeVisible()

    const reciprocal = await sendInterest(b.page, memberA.slug)
    expect(reciprocal.ok()).toBe(true)
    expect(await reciprocal.json()).toMatchObject({ matched: true, queued: false })

    await b.page.goto('/matches')
    await expect(b.page.locator('article').filter({ hasText: memberA.name })).toBeVisible()
  } finally {
    await Promise.allSettled([a.context.close(), b.context.close()])
    await clearInterestInboxFixtures(memberA.id)
    await resetRelationshipPair(memberA.id, memberB.id)
    await configureEligibilityScenario(memberA.id, memberB.id, 'compatible')
  }
})
