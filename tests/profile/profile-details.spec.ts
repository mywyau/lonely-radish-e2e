import { expect, test } from '@playwright/test'
import { profileDetailsSnapshot, restoreProfileDetails } from '../support/database.js'
import { env, hasLifecycleEnvironment } from '../support/env.js'
import { openMember } from '../support/member.js'

test('bio and lifestyle edits persist and appear on both profile views', async ({ browser }) => {
  test.skip(!hasLifecycleEnvironment(), 'Run npm run prepare:staging to create the lifecycle accounts')
  test.setTimeout(90_000)

  const memberA = { id: env('E2E_MEMBER_A_ID'), slug: env('E2E_MEMBER_A_SLUG') }
  const original = await profileDetailsSnapshot(memberA.id)
  const editedBio = 'I enjoy thoughtful exhibitions, relaxed coffee walks, and making plans people can look forward to.'
  const a = await openMember(browser, 'E2E_MEMBER_A_STATE')
  const b = await openMember(browser, 'E2E_MEMBER_B_STATE')

  try {
    await test.step('Alice saves her About me and lifestyle details', async () => {
      await a.page.goto('/profile/details')
      await a.page.getByLabel('Height', { exact: false }).fill('171')
      await a.page.getByLabel('Weight', { exact: false }).fill('68')
      await a.page.getByLabel('Daily rhythm', { exact: false }).selectOption('early_bird')
      await a.page.getByLabel('Drinking', { exact: false }).selectOption('socially')
      await a.page.getByLabel('Smoking', { exact: false }).selectOption('never')

      const lifestyleSaved = a.page.waitForResponse(response => response.request().method() === 'PUT'
        && new URL(response.url()).pathname === '/api/profile/lifestyle')
      await a.page.getByRole('button', { name: 'Save lifestyle details' }).click()
      expect((await lifestyleSaved).ok()).toBe(true)
      await expect(a.page.getByText('Lifestyle details saved.', { exact: true })).toBeVisible()

      await a.page.getByLabel('Your introduction').fill(editedBio)
      const bioSaved = a.page.waitForResponse(response => response.request().method() === 'PUT'
        && new URL(response.url()).pathname === '/api/profile/bio')
      await a.page.getByRole('button', { name: 'Save About me' }).click()
      expect((await bioSaved).ok()).toBe(true)
      await expect(a.page.getByText('About me saved.', { exact: true })).toBeVisible()
    })

    await test.step('the saved values survive a reload', async () => {
      await a.page.reload()
      await expect(a.page.getByLabel('Your introduction')).toHaveValue(editedBio)
      await expect(a.page.getByLabel('Height', { exact: false })).toHaveValue('171')
      await expect(a.page.getByLabel('Daily rhythm', { exact: false })).toHaveValue('early_bird')
    })

    for (const view of [
      { page: a.page, path: '/profile/preview' },
      { page: b.page, path: `/profiles/${memberA.slug}` },
    ]) {
      await test.step(`${view.path.includes('preview') ? 'Alice' : 'Blair'} sees the same public details`, async () => {
        await view.page.goto(view.path)
        await view.page.getByRole('button', { name: 'Profile details' }).first().click()
        await expect(view.page.getByText('171 cm', { exact: true }).first()).toBeVisible()
        await expect(view.page.getByText('68 kg', { exact: true }).first()).toBeVisible()
        await expect(view.page.getByText('Prefers mornings', { exact: true }).first()).toBeVisible()
        await expect(view.page.getByText('Drinks socially', { exact: true }).first()).toBeVisible()
        await expect(view.page.getByText('Does not smoke', { exact: true }).first()).toBeVisible()
        await view.page.getByRole('button', { name: 'View About me' }).first().click()
        await expect(view.page.getByText(editedBio, { exact: true }).first()).toBeVisible()
      })
    }
  } finally {
    await Promise.allSettled([a.context.close(), b.context.close()])
    await restoreProfileDetails(memberA.id, original)
  }
})
