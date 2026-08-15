import { expect, test } from '@playwright/test'
import { interestLifecycleState, resetRelationshipPair, waitForNotification } from '../support/database.js'
import { env, hasLifecycleEnvironment } from '../support/env.js'
import { openMember } from '../support/member.js'

test('a recipient can undo an accidental not-for-me decision before making it final', async ({ browser }) => {
  test.skip(!hasLifecycleEnvironment(), 'Run npm run prepare:staging to create the lifecycle accounts')
  const memberA = { id: env('E2E_MEMBER_A_ID'), name: env('E2E_MEMBER_A_NAME') }
  const memberB = { id: env('E2E_MEMBER_B_ID'), name: env('E2E_MEMBER_B_NAME'), slug: env('E2E_MEMBER_B_SLUG') }
  await resetRelationshipPair(memberA.id, memberB.id)
  const a = await openMember(browser, 'E2E_MEMBER_A_STATE')
  const b = await openMember(browser, 'E2E_MEMBER_B_STATE')

  try {
    await test.step('A sends B an interest', async () => {
      await a.page.goto(`/profiles/${memberB.slug}`)
      const button = a.page.getByRole('button', { name: new RegExp(`Show interest(?: in ${memberB.name})?`, 'i') })
      a.page.once('dialog', dialog => dialog.accept())
      await button.click()
      await expect(a.page.getByText(new RegExp(`Interest sent to ${memberB.name}`, 'i'))).toBeVisible()
      await waitForNotification(memberB.id,memberA.id,'interest_received')
    })

    await test.step('B chooses not for me and restores the interest from the undo notice', async () => {
      await b.page.goto('/interests/received')
      const card = b.page.locator('article').filter({ hasText: memberA.name }).first()
      await expect(card).toBeVisible()
      const dialogPromise = b.page.waitForEvent('dialog')
      const clickPromise = card.getByRole('button', { name: 'Not for me' }).click()
      const dialog = await dialogPromise
      expect(dialog.message()).toContain(`Decide not to match with ${memberA.name}?`)
      await dialog.accept()
      await clickPromise
      await expect(card).toBeHidden()
      const undoNotice = b.page.getByRole('status').filter({
        has: b.page.getByRole('button', { name: 'Undo' }),
        hasText: `You chose not to match with ${memberA.name}.`,
      })
      await expect(undoNotice).toContainText(/Undo available for \d+s/)
      const restored = b.page.waitForResponse(response => response.request().method() === 'POST'
        && /\/api\/interests\/[^/]+\/undo$/.test(new URL(response.url()).pathname))
      await undoNotice.getByRole('button', { name: 'Undo' }).click()
      expect((await restored).ok()).toBe(true)
      await expect(card).toBeVisible()
      await expect(b.page.getByText(`${memberA.name} is back in your interests.`)).toBeVisible()
      expect(await interestLifecycleState(memberA.id,memberB.id)).toMatchObject({
        resolution: null, hasNotification: true,
      })
    })

    await test.step('a second decision persists after leaving the page', async () => {
      const card = b.page.locator('article').filter({ hasText: memberA.name }).first()
      b.page.once('dialog', dialog => dialog.accept())
      await card.getByRole('button', { name: 'Not for me' }).click()
      await expect(card).toBeHidden()
      await b.page.reload()
      await expect(b.page.locator('article').filter({ hasText: memberA.name })).toHaveCount(0)
      expect(await interestLifecycleState(memberA.id,memberB.id)).toMatchObject({
        resolution: 'passed', hasNotification: false,
      })

      await a.page.goto(`/profiles/${memberB.slug}`)
      await expect(a.page.getByRole('button', { name: 'Interest closed' })).toBeVisible()
      await expect(a.page.getByText(`${memberB.name} didn’t take this interest further.`)).toBeVisible()
    })
  } finally {
    await Promise.allSettled([a.context.close(), b.context.close()])
    await resetRelationshipPair(memberA.id, memberB.id)
  }
})
