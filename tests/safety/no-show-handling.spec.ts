import { expect, test, type Page } from '@playwright/test'
import {
  configureDateOutcomeEligibility,
  noShowCaseState,
  reliabilityState,
  resetRelationshipPair,
  resetReliabilityForTest,
  restoreReliability,
  seedPastConfirmedDate,
  type ReliabilitySnapshot,
} from '../support/database.js'
import { env, hasLifecycleEnvironment, optionalStatePath } from '../support/env.js'
import { openMember, type MemberSession } from '../support/member.js'

const outsiderState = optionalStatePath('E2E_NEW_MEMBER_STATE')

async function loadFollowUp(page: Page, proposalId: string) {
  const followUp = page.waitForResponse(response => response.request().method() === 'GET'
    && new URL(response.url()).pathname === `/api/dates/${proposalId}/follow-up`)
  const outcome = page.waitForResponse(response => response.request().method() === 'GET'
    && new URL(response.url()).pathname === `/api/dates/${proposalId}/outcome`)
  await page.goto(`/dates/${proposalId}/follow-up`)
  expect((await followUp).ok()).toBe(true)
  expect((await outcome).ok()).toBe(true)
  await expect(page.getByRole('heading', { name: /How did your date with .+ go\?/ })).toBeVisible()
}

async function reportNoShow(page: Page, proposalId: string) {
  await page.getByRole('button', { name: 'They did not attend' }).click()
  await page.getByPlaceholder('Keep this factual and brief.').fill('The agreed meeting time passed and they did not arrive.')
  const reported = page.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname === `/api/dates/${proposalId}/outcome`)
  await page.getByRole('button', { name: 'Save attendance check-in' }).click()
  const response = await reported
  expect(response.ok()).toBe(true)
  expect(await response.json()).toMatchObject({ outcome: 'no_show' })
  await expect(page.getByRole('heading', { name: 'Attendance check-in saved.' })).toBeVisible()
  await expect(page.getByText('Your no-show report is pending for 48 hours.', { exact: true })).toBeVisible()
}

async function cleanup(
  sessions: MemberSession[],
  userA: string,
  userB: string,
  reliability: ReliabilitySnapshot,
) {
  await Promise.allSettled(sessions.map(session => session.context.close()))
  await resetRelationshipPair(userA,userB)
  await restoreReliability(userB,reliability)
}

test.describe('private no-show handling', () => {
  test.skip(!hasLifecycleEnvironment(), 'Run npm run prepare:staging to create the lifecycle accounts')
  test.describe.configure({ mode: 'serial' })

  test('a reported member can dispute within the response window without being restricted', async ({ browser }) => {
    const memberA = { id: env('E2E_MEMBER_A_ID') }
    const memberB = { id: env('E2E_MEMBER_B_ID') }
    const fixture = await seedPastConfirmedDate(memberA.id,memberB.id)
    const originalReliability = await resetReliabilityForTest(memberB.id)
    const a = await openMember(browser, 'E2E_MEMBER_A_STATE')
    const b = await openMember(browser, 'E2E_MEMBER_B_STATE')
    const disputeNote = 'I attended at the agreed place and dispute this report.'

    try {
      await loadFollowUp(a.page,fixture.proposalId)
      await reportNoShow(a.page,fixture.proposalId)

      await loadFollowUp(b.page,fixture.proposalId)
      await expect(b.page.getByRole('heading', { name: 'Your date reported that you did not attend.' })).toBeVisible()
      await expect(b.page.getByText(/You have until .+ to respond\./)).toBeVisible()
      const pending = await noShowCaseState(fixture.proposalId)
      expect(pending?.status).toBe('pending')
      const hoursRemaining = (new Date(pending!.responseDeadline).getTime() - Date.now()) / 3_600_000
      expect(hoursRemaining).toBeGreaterThan(47)
      expect(hoursRemaining).toBeLessThanOrEqual(48.1)

      await b.page.getByPlaceholder('Optional context for your response').fill(disputeNote)
      const disputed = b.page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === `/api/dates/${fixture.proposalId}/outcome-response`)
      await b.page.getByRole('button', { name: 'Dispute report' }).click()
      const disputeResponse = await disputed
      expect(disputeResponse.ok()).toBe(true)
      expect(await disputeResponse.json()).toEqual({ status: 'disputed' })
      expect(await noShowCaseState(fixture.proposalId)).toMatchObject({
        status: 'disputed', responseNote: disputeNote,
      })
      const reliability = await b.page.request.get('/api/account/reliability')
      expect(await reliability.json()).toMatchObject({
        confirmedNoShows: 0, restrictedUntil: null, pendingReports: 0,
      })
    } finally {
      await cleanup([a,b],memberA.id,memberB.id,originalReliability)
    }
  })

  test('acknowledging a report records one private no-show without a first-offence restriction', async ({ browser }) => {
    const memberA = { id: env('E2E_MEMBER_A_ID') }
    const memberB = { id: env('E2E_MEMBER_B_ID') }
    const fixture = await seedPastConfirmedDate(memberA.id,memberB.id)
    const originalReliability = await resetReliabilityForTest(memberB.id)
    const a = await openMember(browser, 'E2E_MEMBER_A_STATE')
    const b = await openMember(browser, 'E2E_MEMBER_B_STATE')

    try {
      await loadFollowUp(a.page,fixture.proposalId)
      await reportNoShow(a.page,fixture.proposalId)
      await loadFollowUp(b.page,fixture.proposalId)

      const acknowledged = b.page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === `/api/dates/${fixture.proposalId}/outcome-response`)
      await b.page.getByRole('button', { name: 'Acknowledge no-show' }).click()
      const acknowledgeResponse = await acknowledged
      expect(acknowledgeResponse.ok()).toBe(true)
      expect(await acknowledgeResponse.json()).toEqual({ status: 'confirmed' })
      expect((await noShowCaseState(fixture.proposalId))?.status).toBe('confirmed')

      const reliabilityLoaded = b.page.waitForResponse(response => response.request().method() === 'GET'
        && new URL(response.url()).pathname === '/api/account/reliability')
      await b.page.goto('/account/controls')
      const reliabilityResponse = await reliabilityLoaded
      expect(reliabilityResponse.ok()).toBe(true)
      expect(await reliabilityResponse.json()).toMatchObject({
        confirmedNoShows: 1, restrictedUntil: null, pendingReports: 0,
      })
      const history = b.page.getByRole('heading', { name: 'Your attendance history' })
        .locator('xpath=ancestor::section[1]')
      const noShows = history.getByText('Confirmed no-shows', { exact: true }).locator('..')
      await expect(noShows.getByText('1', { exact: true })).toBeVisible()
      await expect(history.getByText('Only you can see this.', { exact: false })).toBeVisible()
    } finally {
      await cleanup([a,b],memberA.id,memberB.id,originalReliability)
    }
  })

  test('future, cancelled, and unrelated dates cannot create a no-show case', async ({ browser }) => {
    test.skip(!outsiderState, 'Run npm run prepare:staging to create the third authenticated account')
    const memberA = { id: env('E2E_MEMBER_A_ID') }
    const memberB = { id: env('E2E_MEMBER_B_ID') }
    const fixture = await seedPastConfirmedDate(memberA.id,memberB.id)
    const originalReliability = await resetReliabilityForTest(memberB.id)
    const a = await openMember(browser, 'E2E_MEMBER_A_STATE')
    const outsider = await openMember(browser, 'E2E_NEW_MEMBER_STATE')

    try {
      await configureDateOutcomeEligibility(fixture,'future')
      const future = await a.page.request.post(`/api/dates/${fixture.proposalId}/outcome`, {
        data: { outcome: 'no_show', note: 'This must be rejected.' },
      })
      expect(future.status()).toBe(409)

      await configureDateOutcomeEligibility(fixture,'cancelled')
      const cancelled = await a.page.request.post(`/api/dates/${fixture.proposalId}/outcome`, {
        data: { outcome: 'no_show', note: 'A cancelled date is not a no-show.' },
      })
      expect(cancelled.status()).toBe(409)

      await configureDateOutcomeEligibility(fixture,'past')
      const privateCase = await outsider.page.request.get(`/api/dates/${fixture.proposalId}/outcome`)
      expect(privateCase.status()).toBe(404)
      const unrelatedReport = await outsider.page.request.post(`/api/dates/${fixture.proposalId}/outcome`, {
        data: { outcome: 'no_show', note: 'An outsider cannot report this date.' },
      })
      expect(unrelatedReport.status()).toBe(409)
      expect(await noShowCaseState(fixture.proposalId)).toBeNull()
      const reliability = await reliabilityState(memberB.id)
      expect(reliability).toEqual({ confirmedNoShows: 0, restrictedUntil: null })
    } finally {
      await cleanup([a,outsider],memberA.id,memberB.id,originalReliability)
    }
  })
})
