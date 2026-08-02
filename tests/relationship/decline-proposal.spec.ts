import { expect, test, type Page } from '@playwright/test'
import { resetRelationshipPair } from '../support/database.js'
import { env, hasLifecycleEnvironment } from '../support/env.js'
import { openMember } from '../support/member.js'
import { gotoPlanningRoom } from '../support/navigation.js'

function nextSaturdayAtTwo() {
  const result = new Date()
  const days = (6 - result.getDay() + 7) % 7 || 7
  result.setDate(result.getDate() + days)
  result.setHours(14, 0, 0, 0)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${result.getFullYear()}-${pad(result.getMonth() + 1)}-${pad(result.getDate())}T14:00`
}

async function createMatch(sender: Page, receiver: Page, recipient: { slug: string; name: string }, senderName: string) {
  await sender.goto(`/profiles/${recipient.slug}`)
  sender.once('dialog', dialog => dialog.accept())
  await sender.getByRole('button', { name: new RegExp(`Show interest(?: in ${recipient.name})?`, 'i') }).click()
  await receiver.goto('/interests/received')
  const card = receiver.locator('article').filter({ hasText: senderName }).first()
  await card.getByRole('button', { name: 'Accept and match' }).click()
  await receiver.getByRole('button', { name: 'Yes, match with them' }).click()
}

test('declining a date proposal notifies the sender and leaves the match open', async ({ browser }) => {
  test.skip(!hasLifecycleEnvironment(), 'Run npm run prepare:staging to create the lifecycle accounts')
  const memberA = { id: env('E2E_MEMBER_A_ID'), name: env('E2E_MEMBER_A_NAME'), slug: env('E2E_MEMBER_A_SLUG') }
  const memberB = { id: env('E2E_MEMBER_B_ID'), name: env('E2E_MEMBER_B_NAME'), slug: env('E2E_MEMBER_B_SLUG') }
  await resetRelationshipPair(memberA.id, memberB.id)
  const a = await openMember(browser, 'E2E_MEMBER_A_STATE')
  const b = await openMember(browser, 'E2E_MEMBER_B_STATE')

  try {
    await createMatch(a.page, b.page, memberB, memberA.name)
    await gotoPlanningRoom(a.page, `/plans/${memberB.slug}?new=1`)
    await a.page.getByLabel('Suggest a different activity').fill('Coffee and a gallery walk')
    await a.page.getByLabel('Proposed date and time').fill(nextSaturdayAtTwo())
    await a.page.getByRole('button', { name: 'Use this time' }).click()
    await a.page.getByLabel('Venue name').fill('Barbican Centre')
    await a.page.getByLabel('Public address').fill('Silk Street, London')
    await a.page.getByLabel('UK postcode').fill('EC2Y 8DS')
    await a.page.getByLabel(/I confirm this is a public meeting place/i).check()
    await a.page.getByRole('button', { name: `Confirm and send to ${memberB.name}` }).click()

    await gotoPlanningRoom(b.page, `/plans/${memberA.slug}`)
    await b.page.getByRole('button', { name: 'Decline' }).click()
    await expect(b.page).toHaveURL(/\/matches$/)
    await expect(b.page.locator('article').filter({ hasText: memberA.name }).first()).toBeVisible()

    await a.page.goto('/notifications')
    await expect(a.page.getByText(`${memberB.name} declined the proposed date plan.`)).toBeVisible()
    await a.page.goto('/matches')
    const match = a.page.locator('article').filter({ hasText: memberB.name }).first()
    await expect(match).toBeVisible()
  } finally {
    await Promise.allSettled([a.context.close(), b.context.close()])
    await resetRelationshipPair(memberA.id, memberB.id)
  }
})
