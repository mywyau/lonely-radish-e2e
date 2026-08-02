import { expect, test, type Response } from '@playwright/test'
import {
  clearInterestInboxFixtures,
  configureEligibilityScenario,
  type EligibilityScenario,
  resetRelationshipPair,
} from '../support/database.js'
import { env, hasLifecycleEnvironment } from '../support/env.js'
import { openMember } from '../support/member.js'

test('interest attempts enforce both members’ hard matching preferences', async ({ browser }) => {
  test.skip(!hasLifecycleEnvironment(), 'Run npm run prepare:staging to create the lifecycle accounts')
  const memberA = { id: env('E2E_MEMBER_A_ID') }
  const memberB = { id: env('E2E_MEMBER_B_ID'), slug: env('E2E_MEMBER_B_SLUG') }
  await resetRelationshipPair(memberA.id, memberB.id)
  await clearInterestInboxFixtures(memberB.id)
  await configureEligibilityScenario(memberA.id, memberB.id, 'compatible')
  const a = await openMember(browser, 'E2E_MEMBER_A_STATE')

  async function attemptInterestVisibly(): Promise<Response> {
    await a.page.goto(`/profiles/${memberB.slug}`)
    const responsePromise = a.page.waitForResponse(response =>
      response.url().includes('/api/interests') && response.request().method() === 'POST')
    a.page.once('dialog', dialog => dialog.accept())
    await a.page.getByRole('button', { name: /^Show interest/i }).click()
    return responsePromise
  }

  try {
    const exclusions: Array<{ scenario: Exclude<EligibilityScenario, 'compatible'>; label: string }> = [
      { scenario: 'sender-age', label: 'the sender’s age range' },
      { scenario: 'recipient-age', label: 'the recipient’s age range' },
      { scenario: 'recipient-gender', label: 'the recipient’s gender preference' },
      { scenario: 'recipient-orientation', label: 'the recipient’s orientation preference' },
      { scenario: 'distance', label: 'the pair’s distance limits' },
    ]

    for (const exclusion of exclusions) {
      await test.step(`${exclusion.label} can make the pair ineligible`, async () => {
        await configureEligibilityScenario(memberA.id, memberB.id, exclusion.scenario)
        const response = await attemptInterestVisibly()
        expect(response.status()).toBe(404)
        expect((await response.json()).statusMessage).toBe('Profile not found')
        await expect(a.page.getByRole('alert')
          .filter({ hasText: 'You can’t show interest in this profile right now.' })).toBeVisible()
      })
    }

    await test.step('a mutually compatible pair can send interest', async () => {
      await configureEligibilityScenario(memberA.id, memberB.id, 'compatible')
      const response = await attemptInterestVisibly()
      expect(response.ok()).toBe(true)
      expect(await response.json()).toMatchObject({
        interest: { profileSlug: memberB.slug },
        matched: false,
      })
      await expect(a.page.getByText(/Interest sent to/i)).toBeVisible()
    })
  } finally {
    await Promise.allSettled([a.context.close()])
    await resetRelationshipPair(memberA.id, memberB.id)
    await clearInterestInboxFixtures(memberB.id)
    await configureEligibilityScenario(memberA.id, memberB.id, 'compatible')
  }
})
