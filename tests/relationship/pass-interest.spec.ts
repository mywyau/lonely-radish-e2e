import { expect, test } from '@playwright/test'
import { resetRelationshipPair } from '../support/database.js'
import { env, hasLifecycleEnvironment } from '../support/env.js'
import { openMember } from '../support/member.js'

test('passing on an interest is final and survives a reload', async ({ browser }) => {
  test.skip(!hasLifecycleEnvironment(), 'Run npm run prepare:staging to create the lifecycle accounts')
  test.setTimeout(60_000)
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
    })

    await test.step('B passes with a clear irreversible warning', async () => {
      await b.page.goto('/interests/received')
      const card = b.page.locator('article').filter({ hasText: memberA.name }).first()
      await expect(card).toBeVisible()
      const dialogPromise = b.page.waitForEvent('dialog')
      const clickPromise = card.getByRole('button', { name: 'Pass' }).click()
      const dialog = await dialogPromise
      expect(dialog.message()).toContain(`Pass on ${memberA.name}’s interest?`)
      expect(dialog.message()).toContain('you will not be able to return to it')
      await dialog.accept()
      await clickPromise
      await expect(b.page.getByText(
        `You passed on ${memberA.name}. That decision is final, and no replacement will appear today.`,
      )).toBeVisible()
      await expect(card).toBeHidden()
    })

    await test.step('the passed interest does not return', async () => {
      await b.page.reload()
      await expect(b.page.locator('article').filter({ hasText: memberA.name })).toHaveCount(0)
    })
  } finally {
    await Promise.allSettled([a.context.close(), b.context.close()])
    await resetRelationshipPair(memberA.id, memberB.id)
  }
})
