import { expect, test } from '@playwright/test'
import {
  clearMatchLimitFixtures,
  matchLimitState,
  seedMatchLimitFixtures,
} from '../support/database.js'
import { env, hasLifecycleEnvironment } from '../support/env.js'
import { openMember } from '../support/member.js'

test('concurrent queue activation cannot exceed the limit or activate a match twice', async ({ browser }) => {
  test.skip(!hasLifecycleEnvironment(), 'Run npm run prepare:staging to create the lifecycle accounts')
  const memberA = { id: env('E2E_MEMBER_A_ID') }
  await clearMatchLimitFixtures(memberA.id)
  const a = await openMember(browser, 'E2E_MEMBER_A_STATE')

  try {
    await test.step('only one of two waiting matches can claim the final active slot', async () => {
      const fixtures = await seedMatchLimitFixtures(memberA.id, 2, 2)
      await a.page.goto('/matches')
      const responses = await Promise.all(fixtures.queued.map(match =>
        a.page.request.post(`/api/matches/${match.matchId}/activate`)))
      expect(responses.map(response => response.status()).sort()).toEqual([200, 409])

      const state = await matchLimitState(memberA.id, fixtures.queued.map(match => match.matchId))
      expect(state.activeCount).toBe(3)
      expect(Object.values(state.statuses).filter(status => status === 'active')).toHaveLength(1)
      expect(Object.values(state.statuses).filter(status => status === 'queued')).toHaveLength(1)
      await a.page.reload()
      await expect(a.page.getByText('3/3', { exact: true })).toBeVisible()
    })

    await test.step('the same queued match cannot be activated twice', async () => {
      const fixtures = await seedMatchLimitFixtures(memberA.id, 2, 1)
      const matchId = fixtures.queued[0].matchId
      const responses = await Promise.all([
        a.page.request.post(`/api/matches/${matchId}/activate`),
        a.page.request.post(`/api/matches/${matchId}/activate`),
      ])
      expect(responses.map(response => response.status()).sort()).toEqual([200, 404])
      const state = await matchLimitState(memberA.id, [matchId])
      expect(state.activeCount).toBe(3)
      expect(state.statuses[matchId]).toBe('active')
    })
  } finally {
    await Promise.allSettled([a.context.close()])
    await clearMatchLimitFixtures(memberA.id)
  }
})
