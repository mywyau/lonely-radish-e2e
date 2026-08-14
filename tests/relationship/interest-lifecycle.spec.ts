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
  if (page.url().includes('vercel.com/login') ||
    await page.getByRole('heading', { name: 'Log in to Vercel' }).isVisible().catch(() => false)) {
    throw new Error('Vercel Deployment Protection blocked the test; run ./scripts/prepare-staging.sh to refresh the bypass state')
  }
  const button = page.getByRole('button', {
    name: new RegExp(`Show interest(?: in ${recipient.name})?`, 'i'),
  })
  await expect(button).toBeVisible({ timeout: 15_000 })
  const responsePromise = page.waitForResponse(response =>
    response.url().includes('/api/interests') && response.request().method() === 'POST')
  page.once('dialog', dialog => dialog.accept())
  await button.click()
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

    await test.step('the sender sees the deadline and can undo taking the interest back', async () => {
      await a.page.goto('/interests/sent')
      const card = a.page.locator('article').filter({ hasText: memberB.name }).first()
      await expect(card).toContainText(`Waiting for ${memberB.name}`)
      await expect(card).toContainText('Closes')
      const dialogPromise = a.page.waitForEvent('dialog')
      const clickPromise = card.getByRole('button', { name: 'Take back' }).click()
      const dialog = await dialogPromise
      expect(dialog.message()).toContain(`Take back your interest in ${memberB.name}?`)
      expect(dialog.message()).toContain('30 seconds to undo')
      await dialog.accept()
      await clickPromise
      await expect(card).toContainText('You took this back')
      const undoNotice = a.page.getByRole('status').filter({
        hasText: `You took back your interest in ${memberB.name}.`,
      })
      await expect(undoNotice).toContainText(/Undo available for \d+s/)
      const restored = a.page.waitForResponse(response => response.request().method() === 'POST'
        && /\/api\/interests\/[^/]+\/undo$/.test(new URL(response.url()).pathname))
      await undoNotice.getByRole('button', { name: 'Undo' }).click()
      expect((await restored).ok()).toBe(true)
      await expect(card).toContainText(`Waiting for ${memberB.name}`)
      expect(await interestLifecycleState(memberA.id,memberB.id)).toMatchObject({
        resolution: null, pendingCount: 1, hasNotification: true,
      })

      a.page.once('dialog', dialog => dialog.accept())
      await card.getByRole('button', { name: 'Take back' }).click()
      await expect(card).toContainText('You took this back')
    })

    await test.step('withdrawal persists, removes the notification and releases inbox capacity', async () => {
      await a.page.reload()
      await expect(a.page.locator('article').filter({ hasText: memberB.name }).first())
        .toContainText('You took this back')
      const state = await interestLifecycleState(memberA.id,memberB.id)
      expect(state).toMatchObject({ resolution: 'withdrawn', pendingCount: 0, hasNotification: false })
      expect(state.resolvedAt).not.toBeNull()
    })

    await test.step('the recipient can report and block from the non-actionable history entry', async () => {
      await b.page.goto('/interests/received')
      await expect(b.page.getByRole('heading', { name: 'Earlier interest' })).toBeVisible()
      const card = b.page.locator('article').filter({ hasText: memberA.name }).first()
      await expect(card).toContainText(`${memberA.name} took this back`)
      await expect(card.getByRole('button', { name: /Accept and match|Not for me/ })).toHaveCount(0)
      await expect(card.getByRole('link', { name: 'View profile' })).toBeVisible()
      await card.getByRole('button', { name: 'Report profile' }).click()
      await b.page.getByLabel('Reason').selectOption('harassment')
      await b.page.getByLabel('Details').fill('E2E interest lifecycle safety report.')
      await expect(b.page.getByLabel(`Also block ${memberA.name} immediately`)).toBeChecked()
      await b.page.getByRole('button', { name: 'Submit report' }).click()
      await expect(b.page).toHaveURL(/\/activities\?safety=reported-blocked/)
    })

    await test.step('blocking hides both histories without deleting the evidence', async () => {
      const state = await interestLifecycleState(memberA.id,memberB.id)
      expect(state).toMatchObject({
        resolution: 'withdrawn', blocked: true, relatedReportCount: 1,
        pendingCount: 0, hasNotification: false,
      })
      const received = await b.page.request.get('/api/interests/received')
      expect(received.ok()).toBe(true)
      expect((await received.json()).closedInterests).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: expect.any(String), name: memberA.name })]),
      )
      const sent = await a.page.request.get('/api/interests/sent')
      expect(sent.ok()).toBe(true)
      expect((await sent.json()).interests).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: expect.any(String), name: memberB.name })]),
      )
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
      await expect(card).toContainText('Closed after 14 days')
      await expect(card.getByRole('button', { name: /Accept and match|Not for me/ })).toHaveCount(0)
      await expect(card.getByRole('button', { name: 'Undo' })).toHaveCount(0)
      const state = await interestLifecycleState(memberA.id,memberB.id)
      expect(state).toMatchObject({ resolution: 'expired', pendingCount: 0, hasNotification: false })
      expect(state.resolvedAt).not.toBeNull()
    })

    await test.step('the sender history also labels the final outcome', async () => {
      await a.page.goto('/interests/sent')
      const card = a.page.locator('article').filter({ hasText: memberB.name }).first()
      await expect(card).toContainText('No response after 14 days')
      await expect(card.getByRole('button', { name: 'Take back' })).toHaveCount(0)
      await expect(card.getByRole('button', { name: 'Undo' })).toHaveCount(0)
    })
  } finally {
    await Promise.allSettled([a.context.close(), b.context.close()])
    await resetRelationshipPair(memberA.id, memberB.id)
  }
})
