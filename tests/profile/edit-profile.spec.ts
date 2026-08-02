import { expect, test } from '@playwright/test'
import { publicProfileIdentity, restorePublicProfileIdentity } from '../support/database.js'
import { env, hasLifecycleEnvironment } from '../support/env.js'
import { openMember } from '../support/member.js'

test('an existing member can edit identity and pronouns and see them on both profile views', async ({ browser }) => {
  test.skip(!hasLifecycleEnvironment(), 'Run npm run prepare:staging to create the lifecycle accounts')

  const memberA = { id: env('E2E_MEMBER_A_ID'), slug: env('E2E_MEMBER_A_SLUG') }
  const originalIdentity = await publicProfileIdentity(memberA.id)
  const editedGender = originalIdentity.genderIdentity === 'woman' ? 'neither' : 'woman'
  const editedGenderLabel = editedGender === 'woman' ? 'Woman' : 'Non-binary / another identity'
  const editedPronouns = 'ze/zir'
  const a = await openMember(browser, 'E2E_MEMBER_A_STATE')
  const b = await openMember(browser, 'E2E_MEMBER_B_STATE')

  try {
    await test.step('Alice edits her public identity through account settings', async () => {
      await a.page.goto('/account/v2')
      const accountPanel = a.page.getByRole('button', { name: /Account details/ })
      await expect(accountPanel).toBeVisible()
      if (await accountPanel.getAttribute('aria-expanded') !== 'true') await accountPanel.click()

      const gender = a.page.getByLabel('Gender identity')
      const pronouns = a.page.getByLabel('Pronouns', { exact: false })
      await expect(gender).toHaveValue(originalIdentity.genderIdentity)
      await gender.selectOption(editedGender)
      await pronouns.fill(editedPronouns)

      const savedResponse = a.page.waitForResponse(response =>
        response.request().method() === 'PUT'
        && new URL(response.url()).pathname === '/api/profile/basics')
      await a.page.getByRole('button', { name: 'Save profile' }).click()
      expect((await savedResponse).ok()).toBe(true)
      await expect(a.page.getByText('Profile saved.', { exact: true })).toBeVisible()
    })

    await test.step('Alice sees the saved identity in her private preview', async () => {
      await a.page.goto('/profile/preview')
      await expect(a.page.getByText(editedGenderLabel, { exact: true }).first()).toBeVisible()
      await expect(a.page.getByText(editedPronouns, { exact: true }).first()).toBeVisible()
    })

    await test.step('Blair sees the same identity on Alice’s public profile', async () => {
      await b.page.goto(`/profiles/${memberA.slug}`)
      await expect(b.page.getByText(editedGenderLabel, { exact: true }).first()).toBeVisible()
      await expect(b.page.getByText(editedPronouns, { exact: true }).first()).toBeVisible()
    })
  } finally {
    await Promise.allSettled([a.context.close(), b.context.close()])
    await restorePublicProfileIdentity(memberA.id, originalIdentity)
  }
})
