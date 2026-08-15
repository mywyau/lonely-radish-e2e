import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { resetNewMemberOnboarding } from '../support/database.js'
import { env, optionalStatePath } from '../support/env.js'
import { openMember } from '../support/member.js'

const newMemberState = optionalStatePath('E2E_NEW_MEMBER_STATE')
const photoFixture = resolve(process.cwd(), '../lonely-radish-frontend/public/android-chrome-512x512.png')

test('a new member uploads a real photo and completes onboarding', async ({ browser }) => {
  test.skip(!newMemberState, 'Run npm run prepare:staging to create the incomplete account storage state')
  const userId = env('E2E_NEW_MEMBER_ID')
  await resetNewMemberOnboarding(userId)
  const member = await openMember(browser, 'E2E_NEW_MEMBER_STATE')
  const viewer = await openMember(browser, 'E2E_MEMBER_B_STATE')
  let uploadedPhotoId: string | null = null

  try {
    await test.step('the member saves the required profile, location, and activities', async () => {
      await member.page.goto('/onboarding')
      await member.page.getByLabel('Profile name').fill('Staging New Member')
      await member.page.getByLabel('How do you identify?').selectOption('neither')
      await member.page.getByLabel('Sexual orientation').selectOption('bisexual')
      await member.page.getByLabel('Day').selectOption('15')
      await member.page.getByLabel('Month').selectOption('6')
      await member.page.getByLabel('Year').selectOption('1995')
      await member.page.getByLabel('Short introduction').fill('Synthetic member completing onboarding with a real staging photo upload.')
      await member.page.getByRole('button', { name: 'Continue' }).click()

      await expect(member.page.getByRole('heading', { name: 'Where should we look?' })).toBeVisible()
      await member.page.getByLabel('UK postcode').fill('EC1A 1BB')
      await member.page.getByRole('button', { name: 'Continue' }).click()

      await expect(member.page.getByRole('heading', { name: 'What would you enjoy doing together?' })).toBeVisible()
      const customActivity = member.page.locator('input[placeholder^="Add something to"]').first()
      for (const activity of ['Staging coffee walk', 'Staging gallery walk', 'Staging market walk']) {
        await customActivity.fill(activity)
        await customActivity.locator('xpath=following-sibling::button').click()
      }
    })

    await test.step('the photo is optimised, uploaded to storage, and confirmed by the application', async () => {
      await member.page.getByRole('button', { name: 'Upload a photo' }).click()
      await expect(member.page).toHaveURL(/\/photos\?onboarding=1$/)
      const confirmed = member.page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/profile/photos/confirm')
      await member.page.locator('input[type="file"]').setInputFiles(photoFixture)
      const response = await confirmed
      expect(response.ok()).toBe(true)
      uploadedPhotoId = (await response.json()).id
      await expect(member.page.getByText('1 / 6 photos selected')).toBeVisible()
      await expect(member.page.getByRole('img', { name: 'Profile preview position 1' })).toBeVisible()
    })

    await test.step('the completed profile enters discovery and is visible to another member', async () => {
      // The call-to-action intentionally pulses, so it never satisfies Playwright's
      // normal element-stability check even though it is visible and clickable.
      await member.page.getByRole('link', { name: 'Return to onboarding' }).click({ force: true })
      await expect(member.page.getByText('Profile photo added')).toBeVisible()
      const completed = member.page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/onboarding/complete')
      await member.page.getByRole('button', { name: 'Finish and discover people' }).click()
      expect((await completed).ok()).toBe(true)
      await expect(member.page).toHaveURL(/\/activities$/)

      const status = await member.page.request.get('/api/onboarding/status')
      expect(status.ok()).toBe(true)
      expect(await status.json()).toMatchObject({ complete: true, activityCount: 3, photoCount: 1 })
      const ownProfile = await member.page.request.get('/api/profile/me')
      expect(ownProfile.ok()).toBe(true)
      const slug = (await ownProfile.json()).profile?.slug
      expect(slug).toBeTruthy()
      expect((await viewer.page.request.get(`/api/profiles/${slug}`)).status()).toBe(200)
    })
  } finally {
    if (uploadedPhotoId) {
      await member.page.request.delete(`/api/profile/photos/${uploadedPhotoId}`).catch(() => undefined)
    }
    await Promise.allSettled([member.context.close(), viewer.context.close()])
    await resetNewMemberOnboarding(userId)
  }
})
