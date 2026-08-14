import { expect, test } from '@playwright/test'
import { resetNewMemberOnboarding } from '../support/database.js'
import { env, optionalStatePath } from '../support/env.js'

const newMemberState = optionalStatePath('E2E_NEW_MEMBER_STATE')

test.describe('new member onboarding', () => {
  test.describe.configure({ mode: 'serial' })

  test('orientation identity remains required while detailed dating filters are progressive', async ({ browser }) => {
    test.skip(!newMemberState, 'Run npm run prepare:staging to create the incomplete account storage state')
    const context = await browser.newContext({
      baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
      storageState: newMemberState!,
    })
    const page = await context.newPage()
    await page.goto('/onboarding')

    await expect(page.getByLabel('Sexual orientation')).toBeVisible()
    await expect(page.getByLabel('Weight', { exact: false })).not.toBeVisible()
    await expect(page.getByText('Age, distance, dating, lifestyle and schedule filters remain available later')).toBeVisible()

    const rejected = await context.request.put('/api/preferences/dating', {
      data: {
        genders: ['Women'],
        openToEveryone: false,
        orientations: [],
        noOrientationPreference: false,
        raceEthnicities: [],
        noRaceEthnicityPreference: true,
      },
    })
    expect(rejected.status()).toBe(400)
    expect(await rejected.text()).toContain('Choose at least one sexual orientation')
    await context.close()
  })

  test('a new member needs three activities and a photo to complete onboarding', async ({ browser }) => {
    test.skip(!newMemberState, 'Run npm run prepare:staging to create the incomplete account storage state')
    const userId = env('E2E_NEW_MEMBER_ID')
    await resetNewMemberOnboarding(userId)
    const context = await browser.newContext({
      baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
      storageState: newMemberState!,
    })
    const page = await context.newPage()

    try {
      await page.goto('/onboarding')
      await page.getByLabel('Profile name').fill('Staging New Member')
      await page.getByLabel('How do you identify?').selectOption('neither')
      await page.getByLabel('Sexual orientation').selectOption('bisexual')
      await page.getByLabel('Day').selectOption('15')
      await page.getByLabel('Month').selectOption('6')
      await page.getByLabel('Year').selectOption('1995')
      await page.getByLabel('Short introduction').fill('Synthetic member completing the staging onboarding release journey.')
      await page.getByRole('button', { name: 'Continue' }).click()

      await expect(page.getByRole('heading', { name: 'Where should we look?' })).toBeVisible()
      await page.getByLabel('UK postcode').fill('EC1A 1BB')
      await page.getByRole('button', { name: 'Continue' }).click()

      await expect(page.getByRole('heading', { name: 'What would you enjoy doing together?' })).toBeVisible()
      const customActivity = page.locator('input[placeholder^="Add something to"]').first()
      for (const activity of ['Staging coffee walk', 'Staging gallery walk', 'Staging market walk']) {
        await customActivity.fill(activity)
        await customActivity.locator('xpath=following-sibling::button').click()
      }
      await expect(page.getByRole('button', { name: 'Finish and discover people' })).toBeDisabled()
      await expect(page.getByText('Add a photo to finish.')).toBeVisible()

      const status = await context.request.get('/api/onboarding/status')
      expect(status.ok()).toBe(true)
      expect((await status.json()).complete).toBe(false)
    } finally {
      await context.close()
      await resetNewMemberOnboarding(userId)
    }
  })
})
