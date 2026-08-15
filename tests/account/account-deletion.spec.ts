import { expect, test } from '@playwright/test'
import { waitForAccountDeletion } from '../support/database.js'
import { env, optionalStatePath } from '../support/env.js'
import { openMember } from '../support/member.js'

const deletionMemberState = optionalStatePath('E2E_DELETION_MEMBER_STATE')
const deletionMemberReady = deletionMemberState && [
  'E2E_DELETION_MEMBER_ID',
  'E2E_DELETION_MEMBER_EMAIL',
  'E2E_DELETION_MEMBER_SLUG',
].every(name => {
  try { return Boolean(env(name)) } catch { return false }
})

test('a member confirms permanent account deletion and loses access', async ({ browser }) => {
  test.skip(!deletionMemberReady,
    'Set E2E_DELETION_MEMBER_EMAIL and run npm run prepare:staging to create the disposable account')
  const deletionMember = {
    id: env('E2E_DELETION_MEMBER_ID'),
    email: env('E2E_DELETION_MEMBER_EMAIL'),
    slug: env('E2E_DELETION_MEMBER_SLUG'),
  }
  const member = await openMember(browser, 'E2E_DELETION_MEMBER_STATE')
  const viewer = await openMember(browser, 'E2E_MEMBER_B_STATE')

  try {
    await test.step('the API and UI reject an accidental deletion', async () => {
      const rejected = await member.page.request.delete('/api/account/v2', { data: { confirm: 'keep' } })
      expect(rejected.status()).toBe(400)
      expect(await rejected.text()).toContain('Confirmation text did not match')

      await member.page.goto('/account/v2')
      // Wait for the client-side account load to prove Vue has hydrated the
      // server-rendered controls before clicking the destructive-action panel.
      await expect(member.page.getByText('Loading account details…')).toBeHidden()
      await member.page.getByRole('button', { name: 'Delete my account' }).click()
      const confirmation = member.page.getByPlaceholder('Type DELETE to confirm')
      await expect(confirmation).toBeVisible()
      await confirmation.fill('keep')
      await expect(member.page.getByRole('button', { name: 'Continue to final confirmation' })).toBeDisabled()
      expect((await member.page.request.get('/api/profile/me')).status()).toBe(200)
    })

    let jobId = 0
    await test.step('explicit double confirmation queues deletion and clears the session', async () => {
      await member.page.getByPlaceholder('Type DELETE to confirm').fill('DELETE')
      await member.page.getByRole('button', { name: 'Continue to final confirmation' }).click()
      const dialog = member.page.getByRole('dialog', { name: 'Delete your account permanently?' })
      await expect(dialog).toContainText(deletionMember.email)
      const queued = member.page.waitForResponse(response => response.request().method() === 'DELETE'
        && new URL(response.url()).pathname === '/api/account/v2')
      await dialog.getByRole('button', { name: 'Yes, permanently delete' }).click()
      const response = await queued
      expect(response.status()).toBe(202)
      const body = await response.json()
      expect(body).toMatchObject({ success: true })
      jobId = Number(body.jobId)
      expect(jobId).toBeGreaterThan(0)
      await expect(member.page.getByText('Deletion has started. You are being signed out.')).toBeVisible()
      expect((await member.page.request.get('/api/profile/me')).status()).toBe(401)
    })

    await test.step('the worker removes the account and its public profile', async () => {
      await waitForAccountDeletion(jobId, deletionMember.id)
      expect((await viewer.page.request.get(`/api/profiles/${deletionMember.slug}`)).status()).toBe(404)
    })
  } finally {
    await Promise.allSettled([member.context.close(), viewer.context.close()])
  }
})
