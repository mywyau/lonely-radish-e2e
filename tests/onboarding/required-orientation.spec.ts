import { expect, test } from '@playwright/test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const newMemberState = process.env.E2E_NEW_MEMBER_STATE
const canRun = Boolean(newMemberState && existsSync(resolve(process.cwd(), newMemberState)))

test('orientation identity and dating choices are required in onboarding', async ({ browser }) => {
  test.skip(!canRun, 'Set E2E_NEW_MEMBER_STATE to a dedicated incomplete account storage state')
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    storageState: resolve(process.cwd(), newMemberState!),
  })
  const page = await context.newPage()
  await page.goto('/onboarding')

  await expect(page.getByLabel('Sexual orientation')).toBeVisible()
  await expect(page.getByLabel('Weight', { exact: false })).toBeVisible()

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
