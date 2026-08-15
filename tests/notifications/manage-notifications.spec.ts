import { expect, test } from '@playwright/test'
import {
  restoreNotificationManagementFixtures,
  seedNotificationManagementFixtures,
} from '../support/database.js'
import { env, hasLifecycleEnvironment } from '../support/env.js'
import { openMember } from '../support/member.js'

test('a member can manage notification history and email subscriptions', async ({ browser }) => {
  test.skip(!hasLifecycleEnvironment(), 'Run npm run prepare:staging to create the lifecycle accounts')

  const memberA = { id: env('E2E_MEMBER_A_ID') }
  const memberB = { id: env('E2E_MEMBER_B_ID'), name: env('E2E_MEMBER_B_NAME') }
  const original = await seedNotificationManagementFixtures(memberA.id, memberB.id)
  const a = await openMember(browser, 'E2E_MEMBER_A_STATE')

  try {
    await a.page.goto('/notifications')
    await expect(a.page.getByText('Email settings don’t affect which relevant updates appear here.')).toBeVisible()
    await expect(a.page.getByText(`${memberB.name} showed interest in meeting you.`, { exact: true })).toBeVisible()
    await expect(a.page.getByText(`You and ${memberB.name} matched.`, { exact: true })).toBeVisible()

    await a.page.getByRole('button', { name: 'Mark all read' }).click()
    await expect(a.page.getByRole('button', { name: 'Mark all read' })).toBeHidden()
    await expect(a.page.getByRole('button', { name: 'Mark read' })).toHaveCount(0)

    const interestNotice = a.page.locator('article').filter({
      hasText: `${memberB.name} showed interest in meeting you.`,
    })
    a.page.once('dialog', dialog => dialog.accept())
    await interestNotice.getByRole('button', { name: 'Delete' }).click()
    await expect(interestNotice).toBeHidden()

    await a.page.getByRole('button', { name: 'Delete all' }).click()
    const confirmation = a.page.getByRole('alertdialog')
    await expect(confirmation).toBeVisible()
    await confirmation.getByRole('button', { name: 'Yes, delete all' }).click()
    await expect(a.page.getByRole('heading', { name: 'Nothing new right now' })).toBeVisible()

    const emailSettings = a.page.getByRole('button', { name: /What should we email you about/ })
    await emailSettings.click()
    await a.page.getByLabel('New interests').check()
    await a.page.getByLabel('Date plan updates').check()
    const preferencesSaved = a.page.waitForResponse(response => response.request().method() === 'PUT'
      && new URL(response.url()).pathname === '/api/email/preferences')
    await a.page.getByRole('button', { name: 'Save email preferences' }).click()
    expect((await preferencesSaved).ok()).toBe(true)
    await expect(a.page.getByRole('status').filter({ hasText: 'Email preferences saved.' })).toBeVisible()

    const reloadedEmailPreferences = a.page.waitForResponse(response => response.request().method() === 'GET'
      && new URL(response.url()).pathname === '/api/email/preferences')
    await a.page.reload()
    const reloadedResponse = await reloadedEmailPreferences
    expect(reloadedResponse.ok()).toBe(true)
    await expect(a.page.getByLabel('New interests')).toBeChecked()
    await expect(a.page.getByLabel('Date plan updates')).toBeChecked()
    await expect(a.page.getByLabel('Matches and connections')).not.toBeChecked()
    await a.page.getByRole('button', { name: /What should we email you about/ }).click()

    await a.page.getByRole('button', { name: 'Unsubscribe from all' }).click()
    await expect(a.page.getByRole('status').filter({ hasText: 'Unsubscribed from all email notifications.' })).toBeVisible()
    for (const label of ['New interests', 'Matches and connections', 'Date plan updates', 'Post-date check-ins']) {
      await expect(a.page.getByLabel(label)).not.toBeChecked()
    }
  } finally {
    await Promise.allSettled([a.context.close()])
    await restoreNotificationManagementFixtures(memberA.id, original)
  }
})
