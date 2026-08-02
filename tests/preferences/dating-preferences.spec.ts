import { expect, test } from '@playwright/test'
import { datingPreferenceSnapshot, restoreDatingPreferences } from '../support/database.js'
import { env, hasLifecycleEnvironment } from '../support/env.js'
import { openMember } from '../support/member.js'

const orientationLabels = ['Heterosexual', 'Homosexual', 'Bisexual', 'Another orientation']

test('dating preferences persist the grouped orientation and broad ethnicity choices', async ({ browser }) => {
  test.skip(!hasLifecycleEnvironment(), 'Run npm run prepare:staging to create the lifecycle accounts')

  const memberA = { id: env('E2E_MEMBER_A_ID') }
  const original = await datingPreferenceSnapshot(memberA.id)
  const a = await openMember(browser, 'E2E_MEMBER_A_STATE')

  try {
    await a.page.goto('/preferences/dating')
    await a.page.getByRole('button', { name: 'Everyone', exact: true }).click()
    for (const label of orientationLabels) {
      const button = a.page.getByRole('button', { name: label, exact: true })
      if (await button.getAttribute('aria-pressed') === 'true') await button.click()
    }
    await a.page.getByRole('button', { name: 'Homosexual', exact: true }).click()
    await a.page.getByRole('button', { name: 'Bisexual', exact: true }).click()
    await a.page.getByRole('button', { name: 'Open to all backgrounds', exact: true }).click()
    await a.page.getByRole('button', { name: 'White', exact: true }).click()

    const saved = a.page.waitForResponse(response => response.request().method() === 'PUT'
      && new URL(response.url()).pathname === '/api/preferences/dating')
    await a.page.getByRole('button', { name: 'Save dating preferences' }).click()
    const response = await saved
    expect(response.ok()).toBe(true)
    expect(await response.json()).toMatchObject({
      openToEveryone: true,
      orientations: ['gay_or_lesbian', 'bisexual'],
      raceEthnicities: ['White'],
      noRaceEthnicityPreference: false,
    })
    await expect(a.page.getByText('Dating preferences saved.', { exact: true })).toBeVisible()

    await a.page.reload()
    await expect(a.page.getByRole('button', { name: 'Everyone', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(a.page.getByRole('button', { name: 'Homosexual', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(a.page.getByRole('button', { name: 'Bisexual', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(a.page.getByRole('button', { name: 'Heterosexual', exact: true })).toHaveAttribute('aria-pressed', 'false')
    await expect(a.page.getByRole('button', { name: 'White', exact: true })).toHaveAttribute('aria-pressed', 'true')
  } finally {
    await Promise.allSettled([a.context.close()])
    await restoreDatingPreferences(memberA.id, original)
  }
})
