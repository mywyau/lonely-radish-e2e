import { expect, test, type Page } from '@playwright/test'
import {
  postDateFixtureState,
  resetRelationshipPair,
  seedPastConfirmedDate,
  type PastConfirmedDateFixture,
} from '../support/database.js'
import { env, hasLifecycleEnvironment } from '../support/env.js'
import { openMember, type MemberSession } from '../support/member.js'

async function loadFollowUp(page: Page, proposalId: string) {
  const followUp = page.waitForResponse(response => response.request().method() === 'GET'
    && new URL(response.url()).pathname === `/api/dates/${proposalId}/follow-up`)
  const outcome = page.waitForResponse(response => response.request().method() === 'GET'
    && new URL(response.url()).pathname === `/api/dates/${proposalId}/outcome`)
  await page.goto(`/dates/${proposalId}/follow-up`)
  expect((await followUp).ok()).toBe(true)
  expect((await outcome).ok()).toBe(true)
  await expect(page.getByRole('heading', { name: /Would you meet .+ again\?/ })).toBeVisible()
}

async function confirmDateHappened(page: Page, proposalId: string) {
  await page.getByRole('button', { name: 'Yes, it happened' }).click()
  const saved = page.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname === `/api/dates/${proposalId}/outcome`)
  await page.getByRole('button', { name: 'Save attendance check-in' }).click()
  expect((await saved).ok()).toBe(true)
  await expect(page.getByRole('heading', { name: 'Attendance check-in saved.' })).toBeVisible()
  await expect(page.getByText('You confirmed the date happened.', { exact: true })).toBeVisible()
}

async function answerMeetAgain(
  page: Page,
  proposalId: string,
  answer: 'yes' | 'no',
  note: string,
) {
  const buttonName = answer === 'yes' ? 'Yes, I’d meet again' : 'No, but I wish them well'
  await page.getByRole('button', { name: buttonName, exact: true }).click()
  await page.getByLabel('Optional note').fill(note)
  const saved = page.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname === `/api/dates/${proposalId}/follow-up`)
  await page.getByRole('button', { name: 'Submit private answer' }).click()
  expect((await saved).ok()).toBe(true)
}

async function closeSessionsAndReset(
  sessions: MemberSession[],
  userA: string,
  userB: string,
) {
  await Promise.allSettled(sessions.map(session => session.context.close()))
  await resetRelationshipPair(userA,userB)
}

test.describe('post-date private check-in', () => {
  test.skip(!hasLifecycleEnvironment(), 'Run npm run prepare:staging to create the lifecycle accounts')
  test.describe.configure({ mode: 'serial' })

  const memberA = () => ({ id: env('E2E_MEMBER_A_ID'), name: env('E2E_MEMBER_A_NAME') })
  const memberB = () => ({ id: env('E2E_MEMBER_B_ID'), name: env('E2E_MEMBER_B_NAME') })

  test('both members confirm attendance and independently choose to meet again', async ({ browser }) => {
    const aMember = memberA()
    const bMember = memberB()
    const fixture = await seedPastConfirmedDate(aMember.id,bMember.id)
    const a = await openMember(browser, 'E2E_MEMBER_A_STATE')
    const b = await openMember(browser, 'E2E_MEMBER_B_STATE')
    const aliceNote = 'I had a lovely time and would enjoy another gallery trip.'
    const blairNote = 'I would happily make another plan together.'

    try {
      await loadFollowUp(a.page,fixture.proposalId)
      await confirmDateHappened(a.page,fixture.proposalId)
      await loadFollowUp(b.page,fixture.proposalId)
      await confirmDateHappened(b.page,fixture.proposalId)

      await answerMeetAgain(a.page,fixture.proposalId,'yes',aliceNote)
      await expect(a.page.getByRole('heading', { name: 'Your answer is saved.' })).toBeVisible()
      await expect(a.page.getByText(`We’re waiting for ${bMember.name}`, { exact: false })).toBeVisible()
      const privateResult = await a.page.request.get(`/api/dates/${fixture.proposalId}/follow-up`)
      expect(privateResult.ok()).toBe(true)
      expect(await privateResult.json()).toMatchObject({
        myChoice: true, bothResponded: false, theirChoice: null, theirMessage: null,
      })

      await loadFollowUp(b.page,fixture.proposalId)
      await expect(b.page.getByText(aliceNote, { exact: false })).toHaveCount(0)
      await answerMeetAgain(b.page,fixture.proposalId,'yes',blairNote)
      await expect(b.page.getByRole('heading', { name: 'You both want to meet again.' })).toBeVisible()
      await expect(b.page.getByText(aliceNote, { exact: false }).first()).toBeVisible()

      await loadFollowUp(a.page,fixture.proposalId)
      await expect(a.page.getByRole('heading', { name: 'You both want to meet again.' })).toBeVisible()
      await expect(a.page.getByText(blairNote, { exact: false }).first()).toBeVisible()
      expect(await postDateFixtureState(fixture)).toEqual({
        matchStatus: 'active', followUpResponses: 2, attendedResponses: 2,
      })
    } finally {
      await closeSessionsAndReset([a,b],aMember.id,bMember.id)
    }
  })

  test('different private answers close the connection until the no answer is reconsidered', async ({ browser }) => {
    const aMember = memberA()
    const bMember = memberB()
    const fixture: PastConfirmedDateFixture = await seedPastConfirmedDate(aMember.id,bMember.id)
    const a = await openMember(browser, 'E2E_MEMBER_A_STATE')
    const b = await openMember(browser, 'E2E_MEMBER_B_STATE')
    const privateNoNote = 'Thank you for meeting me. I wish you all the best.'
    const privateYesNote = 'I would be open to another date.'
    const reconsideration = 'I answered too quickly. I would genuinely like to meet again.'

    try {
      await loadFollowUp(a.page,fixture.proposalId)
      await answerMeetAgain(a.page,fixture.proposalId,'no',privateNoNote)
      await expect(a.page.getByRole('heading', { name: 'Your answer is saved.' })).toBeVisible()

      await loadFollowUp(b.page,fixture.proposalId)
      await expect(b.page.getByText(privateNoNote, { exact: false })).toHaveCount(0)
      const hiddenResult = await b.page.request.get(`/api/dates/${fixture.proposalId}/follow-up`)
      expect(hiddenResult.ok()).toBe(true)
      expect(await hiddenResult.json()).toMatchObject({ bothResponded: false, theirChoice: null, theirMessage: null })

      await answerMeetAgain(b.page,fixture.proposalId,'yes',privateYesNote)
      await expect(b.page.getByRole('heading', { name: 'Your answers were different.' })).toBeVisible()
      await expect(b.page.getByText(privateNoNote, { exact: false }).first()).toBeVisible()
      expect((await postDateFixtureState(fixture)).matchStatus).toBe('unmatched')

      await loadFollowUp(a.page,fixture.proposalId)
      await expect(a.page.getByRole('heading', { name: 'Changed your mind?' })).toBeVisible()
      await a.page.getByLabel('Apology note').fill(reconsideration)
      const reconsidered = a.page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === `/api/dates/${fixture.proposalId}/follow-up/reconsider`)
      await a.page.getByRole('button', { name: 'Change to yes and send note' }).click()
      expect((await reconsidered).ok()).toBe(true)
      await expect(a.page.getByRole('heading', { name: 'You both want to meet again.' })).toBeVisible()

      await loadFollowUp(b.page,fixture.proposalId)
      await expect(b.page.getByRole('heading', { name: 'You both want to meet again.' })).toBeVisible()
      await expect(b.page.getByText(reconsideration, { exact: false }).first()).toBeVisible()
      expect((await postDateFixtureState(fixture)).matchStatus).toBe('active')
    } finally {
      await closeSessionsAndReset([a,b],aMember.id,bMember.id)
    }
  })
})
