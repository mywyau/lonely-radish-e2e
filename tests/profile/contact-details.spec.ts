import { expect, test, type Page } from '@playwright/test'
import { clearContactDetails, resetRelationshipPair } from '../support/database.js'
import { env, hasLifecycleEnvironment } from '../support/env.js'
import { openMember } from '../support/member.js'

async function createMatch(sender: Page, receiver: Page, recipient: { slug: string; name: string }, senderName: string) {
  await sender.goto(`/profiles/${recipient.slug}`)
  sender.once('dialog', dialog => dialog.accept())
  await sender.getByRole('button', { name: new RegExp(`Show interest(?: in ${recipient.name})?`, 'i') }).click()
  await receiver.goto('/interests/received')
  const card = receiver.locator('article').filter({ hasText: senderName }).first()
  await card.getByRole('button', { name: 'Accept and match' }).click()
  await receiver.getByRole('button', { name: 'Yes, match with them' }).click()
  await expect(receiver.getByText(new RegExp(`You matched with ${senderName}`, 'i'))).toBeVisible()
}

test('shared contact details are visible only while the members are matched', async ({ browser }) => {
  test.skip(!hasLifecycleEnvironment(), 'Run npm run prepare:staging to create the lifecycle accounts')
  test.setTimeout(90_000)
  const memberA = { id: env('E2E_MEMBER_A_ID'), name: env('E2E_MEMBER_A_NAME'), slug: env('E2E_MEMBER_A_SLUG') }
  const memberB = { id: env('E2E_MEMBER_B_ID'), name: env('E2E_MEMBER_B_NAME'), slug: env('E2E_MEMBER_B_SLUG') }
  await resetRelationshipPair(memberA.id, memberB.id)
  await clearContactDetails(memberA.id)
  const a = await openMember(browser, 'E2E_MEMBER_A_STATE')
  const b = await openMember(browser, 'E2E_MEMBER_B_STATE')

  try {
    await createMatch(a.page, b.page, memberB, memberA.name)

    const contactLoaded = a.page.waitForResponse(response =>
      response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/profile/contact')
    await a.page.goto('/account/v2')
    expect((await contactLoaded).ok()).toBe(true)
    const contactToggle = a.page.getByRole('button', { name: /Contact details for matches/ })
    await contactToggle.click()
    if (await contactToggle.getAttribute('aria-expanded') !== 'true') await contactToggle.click()
    await expect(contactToggle).toHaveAttribute('aria-expanded','true')
    await a.page.getByLabel('Phone number', { exact: false }).fill('+44 7700 900321')
    await a.page.getByLabel('Contact email', { exact: false }).fill('alice.staging@example.com')
    await a.page.getByLabel('Social or contact handle', { exact: false }).fill('@staging_alice')
    await a.page.getByLabel('Share with active matches').check()
    const contactSaved = a.page.waitForResponse(response =>
      response.request().method() === 'PUT' && new URL(response.url()).pathname === '/api/profile/contact')
    await a.page.getByRole('button', { name: 'Save contact details' }).click()
    expect((await contactSaved).ok()).toBe(true)
    await expect(a.page.getByText('Contact details saved.')).toBeVisible()

    await b.page.goto(`/profiles/${memberA.slug}`)
    await b.page.getByRole('button', { name: 'Show shared contact details' }).click()
    await expect(b.page.getByText('@staging_alice', { exact: true })).toBeVisible()
    await expect(b.page.getByRole('link', { name: 'alice.staging@example.com' })).toBeVisible()

    await a.page.goto('/matches')
    const match = a.page.locator('article').filter({ hasText: memberB.name }).first()
    await match.getByRole('button', { name: 'Remove match' }).click()
    const matchRemoved = a.page.waitForResponse(response =>
      response.request().method() === 'DELETE' && /^\/api\/matches\/[^/]+$/.test(new URL(response.url()).pathname))
    await a.page.getByRole('button', { name: 'Yes, remove match' }).click()
    expect((await matchRemoved).ok()).toBe(true)

    const profileResponse = await b.page.request.get(`/api/profiles/${memberA.slug}`)
    expect(profileResponse.ok()).toBe(true)
    expect((await profileResponse.json()).contactDetails).toBeNull()
  } finally {
    await Promise.allSettled([a.context.close(), b.context.close()])
    await resetRelationshipPair(memberA.id, memberB.id)
    await clearContactDetails(memberA.id)
  }
})
