import { expect, test, type Page } from '@playwright/test'
import {
  agePendingInterest,
  interestLifecycleState,
  resetRelationshipPair,
  waitForNotification,
} from '../support/database.js'
import { env, hasLifecycleEnvironment } from '../support/env.js'
import { openMember } from '../support/member.js'

type Member = { id: string; name: string; slug: string }

async function sendInterest(page: Page, recipient: Member): Promise<void> {
  await page.goto(`/profiles/${recipient.slug}`)
  const responsePromise = page.waitForResponse(response =>
    response.url().includes('/api/interests') && response.request().method() === 'POST')
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', {
    name: new RegExp(`Show interest(?: in ${recipient.name})?`, 'i'),
  }).click()
  expect((await responsePromise).ok()).toBe(true)
  await expect(page.getByText(new RegExp(`Interest sent to ${recipient.name}`, 'i'))).toBeVisible()
}

test('a sender can withdraw a pending interest and both histories explain what happened', async ({ browser }) => {
  test.skip(!hasLifecycleEnvironment(), 'Run npm run prepare:staging to create the lifecycle accounts')
  const memberA = {
    id: env('E2E_MEMBER_A_ID'), name: env('E2E_MEMBER_A_NAME'), slug: env('E2E_MEMBER_A_SLUG'),
  }
  const memberB = {
    id: env('E2E_MEMBER_B_ID'), name: env('E2E_MEMBER_B_NAME'), slug: env('E2E_MEMBER_B_SLUG'),
  }
  await resetRelationshipPair(memberA.id, memberB.id)
  const a = await openMember(browser, 'E2E_MEMBER_A_STATE')
  const b = await openMember(browser, 'E2E_MEMBER_B_STATE')

  try {
    await sendInterest(a.page, memberB)
    await waitForNotification(memberB.id,memberA.id,'interest_received')

    await test.step('the sender sees the deadline and confirms an irreversible withdrawal', async () => {
      await a.page.goto('/interests/sent')
      const card = a.page.locator('article').filter({ hasText: memberB.name }).first()
      await expect(card).toContainText('Pending')
      await expect(card).toContainText('Expires')
      const dialogPromise = a.page.waitForEvent('dialog')
      const clickPromise = card.getByRole('button', { name: 'Withdraw' }).click()
      const dialog = await dialogPromise
      expect(dialog.message()).toContain(`Withdraw your interest in ${memberB.name}?`)
      expect(dialog.message()).toContain('cannot send it again')
      await dialog.accept()
      await clickPromise
      await expect(card).toContainText('Withdrawn')
      await expect(card.getByRole('button', { name: 'Withdraw' })).toHaveCount(0)
    })

    await test.step('withdrawal persists, removes the notification and releases inbox capacity', async () => {
      await a.page.reload()
      await expect(a.page.locator('article').filter({ hasText: memberB.name }).first())
        .toContainText('Withdrawn')
      const state = await interestLifecycleState(memberA.id,memberB.id)
      expect(state).toMatchObject({ resolution: 'withdrawn', pendingCount: 0, hasNotification: false })
      expect(state.resolvedAt).not.toBeNull()
    })

    await test.step('the recipient sees a clear non-actionable history entry', async () => {
      await b.page.goto('/interests/received')
      await expect(b.page.getByRole('heading', { name: 'Recently closed' })).toBeVisible()
      const card = b.page.locator('article').filter({ hasText: memberA.name }).first()
      await expect(card).toContainText('Withdrawn by sender')
      await expect(card.getByRole('button', { name: /Accept|Pass/ })).toHaveCount(0)
    })
  } finally {
    await Promise.allSettled([a.context.close(), b.context.close()])
    await resetRelationshipPair(memberA.id, memberB.id)
  }
})

test('an overdue interest expires silently and releases the recipient inbox slot', async ({ browser }) => {
  test.skip(!hasLifecycleEnvironment(), 'Run npm run prepare:staging to create the lifecycle accounts')
  const memberA = {
    id: env('E2E_MEMBER_A_ID'), name: env('E2E_MEMBER_A_NAME'), slug: env('E2E_MEMBER_A_SLUG'),
  }
  const memberB = {
    id: env('E2E_MEMBER_B_ID'), name: env('E2E_MEMBER_B_NAME'), slug: env('E2E_MEMBER_B_SLUG'),
  }
  await resetRelationshipPair(memberA.id, memberB.id)
  const a = await openMember(browser, 'E2E_MEMBER_A_STATE')
  const b = await openMember(browser, 'E2E_MEMBER_B_STATE')

  try {
    await sendInterest(a.page, memberB)
    await waitForNotification(memberB.id,memberA.id,'interest_received')
    await agePendingInterest(memberA.id,memberB.id)

    await test.step('opening the recipient history closes the overdue interest without an alert', async () => {
      await b.page.goto('/interests/received')
      await expect(b.page.getByText('Nobody here yet')).toBeVisible()
      const card = b.page.locator('article').filter({ hasText: memberA.name }).first()
      await expect(card).toContainText('Expired')
      await expect(card.getByRole('button', { name: /Accept|Pass/ })).toHaveCount(0)
      const state = await interestLifecycleState(memberA.id,memberB.id)
      expect(state).toMatchObject({ resolution: 'expired', pendingCount: 0, hasNotification: false })
      expect(state.resolvedAt).not.toBeNull()
    })

    await test.step('the sender history also labels the final outcome', async () => {
      await a.page.goto('/interests/sent')
      const card = a.page.locator('article').filter({ hasText: memberB.name }).first()
      await expect(card).toContainText('Expired')
      await expect(card.getByRole('button', { name: 'Withdraw' })).toHaveCount(0)
    })
  } finally {
    await Promise.allSettled([a.context.close(), b.context.close()])
    await resetRelationshipPair(memberA.id, memberB.id)
  }
})
