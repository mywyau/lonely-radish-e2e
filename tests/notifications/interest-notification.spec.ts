import { expect, test } from '@playwright/test'
import { resetRelationshipPair, waitForNotification } from '../support/database.js'
import { env, hasLifecycleEnvironment } from '../support/env.js'
import { openMember } from '../support/member.js'

test('a received interest creates an in-app notification that can be marked read', async ({ browser }) => {
  test.skip(!hasLifecycleEnvironment(), 'Run npm run prepare:staging to create the lifecycle accounts')
  const memberA = { id: env('E2E_MEMBER_A_ID'), name: env('E2E_MEMBER_A_NAME') }
  const memberB = { id: env('E2E_MEMBER_B_ID'), name: env('E2E_MEMBER_B_NAME'), slug: env('E2E_MEMBER_B_SLUG') }
  await resetRelationshipPair(memberA.id, memberB.id)
  const a = await openMember(browser, 'E2E_MEMBER_A_STATE')
  const b = await openMember(browser, 'E2E_MEMBER_B_STATE')

  try {
    await a.page.goto(`/profiles/${memberB.slug}`)
    a.page.once('dialog', dialog => dialog.accept())
    await a.page.getByRole('button', { name: new RegExp(`Show interest(?: in ${memberB.name})?`, 'i') }).click()
    await waitForNotification(memberB.id,memberA.id,'interest_received')

    await b.page.goto('/notifications')
    const notice = b.page.locator('article').filter({
      hasText: `${memberA.name} showed interest in meeting you.`,
    }).first()
    await expect(notice).toBeVisible()
    await notice.getByRole('button', { name: 'Mark read' }).click()
    await expect(notice.getByRole('button', { name: 'Mark read' })).toBeHidden()

    await b.page.goto('/interests/received')
    const interest = b.page.locator('article').filter({ hasText: memberA.name }).first()
    await interest.getByRole('button', { name: 'Accept and match' }).click()
    await b.page.getByRole('button', { name: 'Yes, match with them' }).click()
    await b.page.goto('/notifications')
    await expect(b.page.getByText(`${memberA.name} showed interest in meeting you.`)).toHaveCount(0)
  } finally {
    await Promise.allSettled([a.context.close(), b.context.close()])
    await resetRelationshipPair(memberA.id, memberB.id)
  }
})
