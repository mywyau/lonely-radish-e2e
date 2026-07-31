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
