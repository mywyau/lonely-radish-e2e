import { expect, test } from '@playwright/test'
import {
  resetRelationshipPair,
  restoreSchedulePreferences,
  schedulePreferenceSnapshot,
} from '../support/database.js'
import { env, hasLifecycleEnvironment } from '../support/env.js'
import { openMember } from '../support/member.js'

test('schedule changes persist and pre-match visibility remains under the member’s control', async ({ browser }) => {
  test.skip(!hasLifecycleEnvironment(), 'Run npm run prepare:staging to create the lifecycle accounts')
  test.setTimeout(30_000)

  const memberA = { id: env('E2E_MEMBER_A_ID'), slug: env('E2E_MEMBER_A_SLUG') }
  const memberB = { id: env('E2E_MEMBER_B_ID') }
  const original = await schedulePreferenceSnapshot(memberA.id)
  await resetRelationshipPair(memberA.id, memberB.id)
  const a = await openMember(browser, 'E2E_MEMBER_A_STATE')
  const b = await openMember(browser, 'E2E_MEMBER_B_STATE')
  const saturdayLabel = 'Saturday · 11:30–16:45'

  async function saveSchedule() {
    const saved = a.page.waitForResponse(response => response.request().method() === 'PUT'
      && new URL(response.url()).pathname === '/api/preferences/schedule')
    await a.page.getByRole('button', { name: 'Save schedule' }).click()
    const response = await saved
    expect(response.ok()).toBe(true)
    await expect(a.page.getByText('Schedule saved.', { exact: true })).toBeVisible()
  }

  try {
    const scheduleLoaded = a.page.waitForResponse(response => response.request().method() === 'GET'
      && new URL(response.url()).pathname === '/api/preferences/schedule')
    await a.page.goto('/preferences/schedule')
    const loadedResponse = await scheduleLoaded
    expect(loadedResponse.ok()).toBe(true)
    const loaded = await loadedResponse.json() as { windows: Array<{ weekday: number }> }
    for (const window of loaded.windows) {
      const labels = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
      await expect(a.page.getByLabel(labels[window.weekday], { exact: true })).toBeChecked()
    }

    const resetAll = a.page.getByRole('button', { name: 'Reset all' })
    if (await resetAll.isEnabled()) {
      a.page.once('dialog', dialog => dialog.accept())
      await resetAll.click()
    }

    const saturday = a.page.locator('article').filter({ hasText: 'Saturday' })
    await saturday.getByLabel('Saturday', { exact: true }).check()
    await saturday.getByLabel('From').fill('11:30')
    await saturday.getByLabel('Until').fill('16:45')
    await a.page.getByLabel('Let people see this before you match', { exact: false }).check()
    await a.page.getByLabel('Only suggest public places', { exact: true }).check()
    await saveSchedule()

    const reloadedSchedule = a.page.waitForResponse(response => response.request().method() === 'GET'
      && new URL(response.url()).pathname === '/api/preferences/schedule')
    await a.page.reload()
    expect((await reloadedSchedule).ok()).toBe(true)
    await expect(saturday.getByLabel('Saturday', { exact: true })).toBeChecked()
    await expect(saturday.getByLabel('From')).toHaveValue('11:30')
    await expect(saturday.getByLabel('Until')).toHaveValue('16:45')
    await expect(a.page.getByLabel('Let people see this before you match', { exact: false })).toBeChecked()

    await b.page.goto(`/profiles/${memberA.slug}`)
    await expect(b.page.getByRole('heading', { name: 'Usually free' }).first()).toBeVisible()
    await expect(b.page.getByText(saturdayLabel, { exact: true }).first()).toBeVisible()

    await a.page.getByLabel('Let people see this before you match', { exact: false }).uncheck()
    await saveSchedule()
    await b.page.reload()
    await expect(b.page.getByRole('heading', { name: 'Usually free' })).toHaveCount(0)
    const privateProfile = await b.page.request.get(`/api/profiles/${memberA.slug}`)
    expect(privateProfile.ok()).toBe(true)
    expect((await privateProfile.json()).availability).toEqual([])
  } finally {
    await Promise.allSettled([a.context.close(), b.context.close()])
    await restoreSchedulePreferences(memberA.id, original)
    await resetRelationshipPair(memberA.id, memberB.id)
  }
})
