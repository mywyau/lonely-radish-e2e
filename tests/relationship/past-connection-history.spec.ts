import { expect, test } from '@playwright/test'
import { resetRelationshipPair, seedPastConnectionWithNewerUnconfirmedPlan } from '../support/database.js'
import { env, hasLifecycleEnvironment } from '../support/env.js'
import { openMember } from '../support/member.js'

test('past connections show the last mutually agreed plan, not a newer unconfirmed proposal', async ({ browser }) => {
  test.skip(!hasLifecycleEnvironment(), 'Run npm run prepare:staging to create the lifecycle accounts')
  const memberA = { id: env('E2E_MEMBER_A_ID') }
  const memberB = { id: env('E2E_MEMBER_B_ID'), name: env('E2E_MEMBER_B_NAME') }
  await seedPastConnectionWithNewerUnconfirmedPlan(memberA.id,memberB.id)
  const a = await openMember(browser, 'E2E_MEMBER_A_STATE')

  try {
    await a.page.goto('/matches/past')
    const connection = a.page.locator('article').filter({ hasText: memberB.name }).first()
    await expect(connection).toContainText('Last agreed plan: Gallery visit')
    await expect(connection).not.toContainText('Coffee walk')
  } finally {
    await a.context.close()
    await resetRelationshipPair(memberA.id,memberB.id)
  }
})
