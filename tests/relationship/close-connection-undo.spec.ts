import { expect, test } from '@playwright/test'
import { postDateFixtureState, resetRelationshipPair, seedPastConfirmedDate } from '../support/database.js'
import { env, hasLifecycleEnvironment } from '../support/env.js'
import { openMember } from '../support/member.js'

test('closing a connection waits for the undo window before deleting its plans', async ({ browser }) => {
  test.skip(!hasLifecycleEnvironment(), 'Run npm run prepare:staging to create the lifecycle accounts')
  const memberA = { id: env('E2E_MEMBER_A_ID') }
  const memberB = { id: env('E2E_MEMBER_B_ID'), name: env('E2E_MEMBER_B_NAME') }
  const fixture = await seedPastConfirmedDate(memberA.id,memberB.id)
  const a = await openMember(browser, 'E2E_MEMBER_A_STATE')

  try {
    await a.page.goto('/matches')
    const card = a.page.locator('article').filter({ hasText: memberB.name }).first()
    await expect(card).toBeVisible()

    await test.step('undo restores the card before any destructive request is sent', async () => {
      let deleteRequests = 0
      const countDelete = (request: { method(): string; url(): string }) => {
        if (request.method() === 'DELETE' && new URL(request.url()).pathname === `/api/matches/${fixture.matchId}`) {
          deleteRequests += 1
        }
      }
      a.page.on('request', countDelete)
      await card.getByRole('button', { name: 'Close connection' }).click()
      const dialog = a.page.getByRole('alertdialog', { name: `Close your connection with ${memberB.name}?` })
      await expect(dialog).toContainText('you’ll have 10 seconds to undo')
      await dialog.getByRole('button', { name: 'Yes, close connection' }).click()
      await expect(card).toBeHidden()

      const undoNotice = a.page.getByRole('status').filter({
        hasText: `Connection with ${memberB.name} is ready to close.`,
      })
      await expect(undoNotice).toContainText(/Undo available for \d+s/)
      expect(deleteRequests).toBe(0)
      expect(await postDateFixtureState(fixture)).toMatchObject({ matchStatus: 'active' })
      await undoNotice.getByRole('button', { name: 'Undo' }).click()
      await expect(card).toBeVisible()
      expect(deleteRequests).toBe(0)
      expect(await postDateFixtureState(fixture)).toMatchObject({ matchStatus: 'active' })
      a.page.off('request', countDelete)
    })

    await test.step('without undo the connection closes after the delay', async () => {
      await card.getByRole('button', { name: 'Close connection' }).click()
      const closed = a.page.waitForResponse(response => response.request().method() === 'DELETE'
        && new URL(response.url()).pathname === `/api/matches/${fixture.matchId}`)
      await a.page.getByRole('alertdialog').getByRole('button', { name: 'Yes, close connection' }).click()
      expect((await closed).ok()).toBe(true)
      await expect(card).toBeHidden()
      expect(await postDateFixtureState(fixture)).toMatchObject({ matchStatus: 'unmatched' })
    })
  } finally {
    await a.context.close()
    await resetRelationshipPair(memberA.id,memberB.id)
  }
})
