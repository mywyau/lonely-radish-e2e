import { expect, test, type Page } from '@playwright/test'
import {
  addQueuedMatchLimitFixture,
  clearMatchLimitFixtures,
  configureEligibilityScenario,
  matchLimitState,
  resetRelationshipPair,
  seedMatchLimitFixtures,
} from '../support/database.js'
import { env, hasLifecycleEnvironment } from '../support/env.js'
import { openMember } from '../support/member.js'

function futureDate() {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
}

async function sendVisibleInterest(page: Page, slug: string) {
  await page.goto(`/profiles/${slug}`)
  const responsePromise = page.waitForResponse(response =>
    response.url().includes('/api/interests') && response.request().method() === 'POST')
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: /^Show interest/i }).click()
  return responsePromise
}

test('a full free match list queues, explains, and promotes the oldest eligible match', async ({ browser }) => {
  test.skip(!hasLifecycleEnvironment(), 'Run npm run prepare:staging to create the lifecycle accounts')
  test.setTimeout(150_000)
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
  await clearMatchLimitFixtures(memberA.id)
  await clearMatchLimitFixtures(memberB.id)
  await configureEligibilityScenario(memberA.id, memberB.id, 'compatible')
  const capacity = await seedMatchLimitFixtures(memberA.id, 3, 0)
  const a = await openMember(browser, 'E2E_MEMBER_A_STATE')
  const b = await openMember(browser, 'E2E_MEMBER_B_STATE')
  let queuedMatchId = ''
  let newerQueuedMatchId = ''

  try {
    await test.step('a new mutual match waits when a free member already has three active matches', async () => {
      const first = await sendVisibleInterest(a.page, memberB.slug)
      expect(first.ok()).toBe(true)
      expect((await first.json()).matched).toBe(false)

      const reciprocal = await sendVisibleInterest(b.page, memberA.slug)
      expect(reciprocal.ok()).toBe(true)
      const result = await reciprocal.json()
      expect(result).toMatchObject({ matched: true, queued: true })

      const sent = await b.page.request.get('/api/interests/sent')
      const sentBody = await sent.json()
      const queuedInterest = sentBody.interests?.find((interest: { slug: string }) => interest.slug === memberA.slug)
      expect(queuedInterest).toMatchObject({ queued: true })
    })

    await test.step('both members see why the match is waiting', async () => {
      await Promise.all([a.page.goto('/matches'), b.page.goto('/matches')])
      const aCard = a.page.locator('article').filter({ hasText: memberB.name }).first()
      const bCard = b.page.locator('article').filter({ hasText: memberA.name }).first()
      await expect(a.page.getByText('3/3', { exact: true })).toBeVisible()
      await expect(a.page.getByRole('heading', { name: 'Matches waiting' })).toBeVisible()
      await expect(aCard.getByText('Waiting for space', { exact: true })).toBeVisible()
      await expect(bCard.getByText('Waiting for space', { exact: true })).toBeVisible()
      await expect(aCard.getByRole('button', { name: 'Activate match' })).toBeVisible()
      await expect(bCard.getByRole('button', { name: 'Activate match' })).toBeVisible()

      const matches = await a.page.request.get('/api/matches')
      const body = await matches.json()
      queuedMatchId = body.matches.find((match: { slug: string }) => match.slug === memberB.slug)?.id || ''
      expect(queuedMatchId).not.toBe('')
    })

    await test.step('planning is unavailable while the match is queued', async () => {
      const response = await a.page.request.post('/api/proposals', {
        data: {
          profileSlug: memberB.slug,
          activity: 'Queue safety coffee',
          inviteNote: 'This should not be created yet.',
          venue: 'Barbican Centre',
          venueAddress: 'Silk Street, London',
          venuePostcode: 'EC2Y 8DS',
          meetingPoint: 'At the box office',
          publicVenueConfirmed: true,
          times: [futureDate()],
        },
      })
      expect(response.status()).toBe(404)
      expect((await response.json()).statusMessage).toBe('Active match not found')
    })

    await test.step('removing an active match promotes the oldest eligible waiting match', async () => {
      const newerQueued = await addQueuedMatchLimitFixture(memberA.id, 0)
      newerQueuedMatchId = newerQueued.matchId
      await a.page.reload()
      const activeCard = a.page.locator('article').filter({ hasText: capacity.active[0].name }).first()
      await activeCard.getByRole('button', { name: 'Remove match' }).click()
      const dialog = a.page.getByRole('alertdialog')
      await dialog.getByRole('button', { name: 'Yes, remove match' }).click()
      await expect(activeCard).toBeHidden()

      await Promise.all([a.page.reload(), b.page.reload()])
      const aCard = a.page.locator('article').filter({ hasText: memberB.name }).first()
      const bCard = b.page.locator('article').filter({ hasText: memberA.name }).first()
      await expect(aCard.getByText('Ready to plan', { exact: true })).toBeVisible()
      await expect(bCard.getByText('Ready to plan', { exact: true })).toBeVisible()
      await expect(a.page.getByText('3/3', { exact: true })).toBeVisible()

      const state = await matchLimitState(memberA.id, [queuedMatchId, newerQueuedMatchId])
      expect(state.activeCount).toBe(3)
      expect(state.statuses[queuedMatchId]).toBe('active')
      expect(state.statuses[newerQueuedMatchId]).toBe('queued')
    })
  } finally {
    await Promise.allSettled([a.context.close(), b.context.close()])
    await resetRelationshipPair(memberA.id, memberB.id)
    await clearMatchLimitFixtures(memberA.id)
    await configureEligibilityScenario(memberA.id, memberB.id, 'compatible')
  }
})
