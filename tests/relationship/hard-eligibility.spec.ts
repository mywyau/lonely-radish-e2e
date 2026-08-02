import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
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
  test.setTimeout(90_000)
  const memberA = { id: env('E2E_MEMBER_A_ID') }
  const memberB = { id: env('E2E_MEMBER_B_ID'), slug: env('E2E_MEMBER_B_SLUG') }
  await resetRelationshipPair(memberA.id, memberB.id)
  await clearInterestInboxFixtures(memberB.id)
  await configureEligibilityScenario(memberA.id, memberB.id, 'compatible')
  const a = await openMember(browser, 'E2E_MEMBER_A_STATE')

  async function attemptInterest() {
    return a.page.request.post('/api/interests', {
      data: { profileSlug: memberB.slug },
      headers: { 'Idempotency-Key': randomUUID() },
    })
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
        const response = await attemptInterest()
        expect(response.status()).toBe(404)
        expect((await response.json()).statusMessage).toBe('Profile not found')
      })
    }

    await test.step('a mutually compatible pair can send interest', async () => {
      await configureEligibilityScenario(memberA.id, memberB.id, 'compatible')
      const response = await attemptInterest()
      expect(response.ok()).toBe(true)
      expect(await response.json()).toMatchObject({
        interest: { profileSlug: memberB.slug },
        matched: false,
      })
    })
  } finally {
    await Promise.allSettled([a.context.close()])
    await resetRelationshipPair(memberA.id, memberB.id)
    await clearInterestInboxFixtures(memberB.id)
    await configureEligibilityScenario(memberA.id, memberB.id, 'compatible')
  }
})
