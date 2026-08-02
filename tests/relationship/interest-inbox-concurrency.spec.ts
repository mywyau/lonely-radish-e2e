import { expect, test, type Page } from '@playwright/test'
import {
  clearInterestInboxFixtures,
  configureEligibilityScenario,
  resetNewMemberOnboarding,
  resetRelationshipPair,
  seedEligibleProfile,
  seedInterestInbox,
} from '../support/database.js'
import { env, hasLifecycleEnvironment, optionalStatePath } from '../support/env.js'
import { openMember } from '../support/member.js'

const newMemberState = optionalStatePath('E2E_NEW_MEMBER_STATE')

test('simultaneous interest attempts cannot overfill the recipient inbox', async ({ browser }) => {
  test.skip(!hasLifecycleEnvironment() || !newMemberState,
    'Run npm run prepare:staging to create all three lifecycle accounts')
  const memberA = { id: env('E2E_MEMBER_A_ID'), name: env('E2E_MEMBER_A_NAME') }
  const memberB = { id: env('E2E_MEMBER_B_ID'), slug: env('E2E_MEMBER_B_SLUG') }
  const newMember = {
    id: env('E2E_NEW_MEMBER_ID'),
    name: env('E2E_NEW_MEMBER_NAME'),
    slug: env('E2E_NEW_MEMBER_SLUG'),
  }
  await resetRelationshipPair(memberA.id, memberB.id)
  await resetRelationshipPair(newMember.id, memberB.id)
  await resetNewMemberOnboarding(newMember.id)
  await clearInterestInboxFixtures(memberB.id)
  await configureEligibilityScenario(memberA.id, memberB.id, 'compatible')
  await seedEligibleProfile(newMember.id, newMember.slug, newMember.name)
  await configureEligibilityScenario(newMember.id, memberB.id, 'compatible')
  await seedInterestInbox(memberB.id, 4)
  const a = await openMember(browser, 'E2E_MEMBER_A_STATE')
  const newcomer = await openMember(browser, 'E2E_NEW_MEMBER_STATE')
  const b = await openMember(browser, 'E2E_MEMBER_B_STATE')

  async function sendVisibleInterest(page: Page) {
    const responsePromise = page.waitForResponse(response =>
      response.url().includes('/api/interests') && response.request().method() === 'POST')
    page.once('dialog', dialog => dialog.accept())
    await page.getByRole('button', { name: /^Show interest/i }).click()
    return responsePromise
  }

  try {
    await Promise.all([
      a.page.goto(`/profiles/${memberB.slug}`),
      newcomer.page.goto(`/profiles/${memberB.slug}`),
    ])
    await expect(a.page).toHaveURL(new RegExp(`/profiles/${memberB.slug}$`))
    await expect(newcomer.page).toHaveURL(new RegExp(`/profiles/${memberB.slug}$`))
    await expect(a.page.getByRole('button', { name: /^Show interest/i })).toBeVisible()
    await expect(newcomer.page.getByRole('button', { name: /^Show interest/i })).toBeVisible()
    const responses = await Promise.all([
      sendVisibleInterest(a.page),
      sendVisibleInterest(newcomer.page),
    ])
    expect(responses.map(response => response.status()).sort()).toEqual([200, 409])

    const winningPage = responses[0].ok() ? a.page : newcomer.page
    const rejectedPage = responses[0].ok() ? newcomer.page : a.page
    await expect(winningPage.getByText(/Interest sent to/i)).toBeVisible()
    await expect(rejectedPage.getByRole('alert')
      .filter({ hasText: 'This person isn’t accepting new interests right now.' })).toBeVisible()

    await b.page.goto('/interests/received')
    await expect(b.page.getByText('5 of 5 current interests')).toBeVisible()
    await expect(b.page.locator('article')).toHaveCount(5)
    const newSenders = b.page.locator('article').filter({
      hasText: new RegExp(`${memberA.name}|${newMember.name}`),
    })
    await expect(newSenders).toHaveCount(1)
  } finally {
    await Promise.allSettled([a.context.close(), newcomer.context.close(), b.context.close()])
    await clearInterestInboxFixtures(memberB.id)
    await resetRelationshipPair(memberA.id, memberB.id)
    await resetRelationshipPair(newMember.id, memberB.id)
    await resetNewMemberOnboarding(newMember.id)
    await configureEligibilityScenario(memberA.id, memberB.id, 'compatible')
  }
})
