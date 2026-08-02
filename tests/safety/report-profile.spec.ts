import { expect, test } from '@playwright/test'
import { resetRelationshipPair } from '../support/database.js'
import { env, hasLifecycleEnvironment } from '../support/env.js'
import { openMember } from '../support/member.js'

test('a signed-in member can submit a safety report without being forced to block', async ({ browser }) => {
  test.skip(!hasLifecycleEnvironment(), 'Run npm run prepare:staging to create the lifecycle accounts')
  const memberA = { id: env('E2E_MEMBER_A_ID'), slug: env('E2E_MEMBER_A_SLUG') }
  const memberB = { id: env('E2E_MEMBER_B_ID'), name: env('E2E_MEMBER_B_NAME'), slug: env('E2E_MEMBER_B_SLUG') }
  await resetRelationshipPair(memberA.id, memberB.id)
  const session = await openMember(browser, 'E2E_MEMBER_A_STATE')
  try {
    await session.page.goto(`/profiles/${memberB.slug}`)
    await session.page.getByRole('button', { name: 'Report profile' }).click()
    const dialog = session.page.getByRole('dialog', { name: `Report ${memberB.name}` })
    await dialog.getByLabel('Reason').selectOption('spam')
    await dialog.getByLabel('Details', { exact: false }).fill('Synthetic staging release-gate report; safe to remove.')
    await dialog.getByLabel(`Also block ${memberB.name} immediately`).uncheck()
    await dialog.getByRole('button', { name: 'Submit report' }).click()
    await expect(session.page).toHaveURL(/\/activities\?safety=reported$/)
  } finally {
    await session.context.close()
    await resetRelationshipPair(memberA.id, memberB.id)
  }
})

test('blocking a member hides both profiles and keeps the block manageable', async ({ browser }) => {
  test.skip(!hasLifecycleEnvironment(), 'Run npm run prepare:staging to create the lifecycle accounts')
  const memberA = { id: env('E2E_MEMBER_A_ID'), name: env('E2E_MEMBER_A_NAME'), slug: env('E2E_MEMBER_A_SLUG') }
  const memberB = { id: env('E2E_MEMBER_B_ID'), name: env('E2E_MEMBER_B_NAME'), slug: env('E2E_MEMBER_B_SLUG') }
  await resetRelationshipPair(memberA.id, memberB.id)
  const a = await openMember(browser, 'E2E_MEMBER_A_STATE')
  const b = await openMember(browser, 'E2E_MEMBER_B_STATE')

  try {
    await test.step('A confirms the consequences and blocks B', async () => {
      await a.page.goto(`/profiles/${memberB.slug}`)
      await a.page.getByRole('button', { name: 'Block user' }).click()
      const dialog = a.page.getByRole('dialog', { name: `Block ${memberB.name}?` })
      await expect(dialog.getByText(/You will no longer see each other/i)).toBeVisible()
      await expect(dialog.getByText(/They will not be told you blocked them/i)).toBeVisible()
      await dialog.getByRole('button', { name: 'Block person' }).click()
      await expect(a.page).toHaveURL(/\/activities\?safety=blocked$/)
    })

    await test.step('A can review the block from account settings', async () => {
      await a.page.goto('/account/blocked')
      const card = a.page.locator('article').filter({ hasText: memberB.name }).first()
      await expect(card).toBeVisible()
      await expect(card.getByRole('button', { name: 'Unblock' })).toBeVisible()
    })

    await test.step('B can no longer retrieve A’s profile', async () => {
      const response = await b.page.request.get(`/api/profiles/${memberA.slug}`)
      expect(response.status()).toBe(404)
    })
  } finally {
    await Promise.allSettled([a.context.close(), b.context.close()])
    await resetRelationshipPair(memberA.id, memberB.id)
  }
})
