import { expect, test } from '@playwright/test'
import { activityPreferenceSnapshot, restoreActivityPreferences } from '../support/database.js'
import { env, hasLifecycleEnvironment } from '../support/env.js'
import { openMember } from '../support/member.js'

test('an existing member can replace activities with a listed and custom date idea', async ({ browser }) => {
  test.skip(!hasLifecycleEnvironment(), 'Run npm run prepare:staging to create the lifecycle accounts')
  test.setTimeout(30_000)

  const memberA = { id: env('E2E_MEMBER_A_ID'), slug: env('E2E_MEMBER_A_SLUG') }
  const original = await activityPreferenceSnapshot(memberA.id)
  const customActivity = 'E2E bookshop wander'
  const a = await openMember(browser, 'E2E_MEMBER_A_STATE')
  const b = await openMember(browser, 'E2E_MEMBER_B_STATE')

  try {
    const activitiesLoaded = a.page.waitForResponse(response => response.request().method() === 'GET'
      && new URL(response.url()).pathname === '/api/preferences/activities')
    await a.page.goto('/preferences/activities')
    const loadedResponse = await activitiesLoaded
    expect(loadedResponse.ok()).toBe(true)
    const loadedActivities = await loadedResponse.json() as { selected: Array<{ name: string }> }
    if (loadedActivities.selected.length) {
      await expect(a.page.getByRole('heading', {
        name: new RegExp(`^Your interests \\(${loadedActivities.selected.length}/`),
      })).toBeVisible()
    }
    const selectedActivities = a.page.locator('section').filter({ hasText: /^Your interests \(/ }).first()
    if (await selectedActivities.isVisible()) {
      while (await selectedActivities.getByRole('button').count()) {
        await selectedActivities.getByRole('button').first().click()
      }
    }

    const cultureGroup = a.page.getByRole('button', { name: 'Culture', exact: true })
    await cultureGroup.click()
    await expect(cultureGroup).toHaveAttribute('aria-expanded', 'true')
    await a.page.getByRole('button', { name: 'Gallery walks', exact: true }).click()
    await a.page.getByPlaceholder('Add something to Culture').fill(customActivity)
    await a.page.getByPlaceholder('Add something to Culture').locator('xpath=following-sibling::button').click()

    const saved = a.page.waitForResponse(response => response.request().method() === 'PUT'
      && new URL(response.url()).pathname === '/api/preferences/activities')
    await a.page.getByRole('button', { name: 'Save activity interests' }).click()
    expect((await saved).ok()).toBe(true)
    await expect(a.page.getByText('Activity interests saved.', { exact: true })).toBeVisible()

    await a.page.reload()
    await expect(a.page.getByRole('button', { name: 'Remove Gallery walks' })).toBeVisible()
    await expect(a.page.getByRole('button', { name: `Remove ${customActivity}` })).toBeVisible()

    await a.page.goto('/profile/preview')
    await expect(a.page.getByText('Gallery walks', { exact: true }).first()).toBeVisible()
    await expect(a.page.getByText(customActivity, { exact: true }).first()).toBeVisible()

    await b.page.goto(`/profiles/${memberA.slug}`)
    await expect(b.page.getByText('Gallery walks', { exact: true }).first()).toBeVisible()
    await expect(b.page.getByText(customActivity, { exact: true }).first()).toBeVisible()
  } finally {
    await Promise.allSettled([a.context.close(), b.context.close()])
    await restoreActivityPreferences(memberA.id, original)
  }
})
