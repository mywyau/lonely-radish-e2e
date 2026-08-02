import { expect, test, type Page } from '@playwright/test'
import { resetRelationshipPair } from '../support/database.js'
import { env, hasLifecycleEnvironment } from '../support/env.js'
import { openMember } from '../support/member.js'
import { gotoPlanningRoom } from '../support/navigation.js'

function nextSaturdayAt(hour: number) {
  const result = new Date()
  const days = (6 - result.getDay() + 7) % 7 || 7
  result.setDate(result.getDate() + days)
  result.setHours(hour, 0, 0, 0)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${result.getFullYear()}-${pad(result.getMonth() + 1)}-${pad(result.getDate())}T${pad(hour)}:00`
}

async function createMatch(sender: Page, receiver: Page, recipient: { slug: string; name: string }, senderName: string) {
  await sender.goto(`/profiles/${recipient.slug}`)
  sender.once('dialog', dialog => dialog.accept())
  await sender.getByRole('button', { name: new RegExp(`Show interest(?: in ${recipient.name})?`, 'i') }).click()
  await expect(sender.getByText(new RegExp(`Interest sent to ${recipient.name}`, 'i'))).toBeVisible()

  await receiver.goto('/interests/received')
  const card = receiver.locator('article').filter({ hasText: senderName }).first()
  await card.getByRole('button', { name: 'Accept and match' }).click()
  await receiver.getByRole('button', { name: 'Yes, match with them' }).click()
  await expect(receiver.getByText(new RegExp(`You matched with ${senderName}`, 'i'))).toBeVisible()
}

async function fillProposal(page: Page, activity: string, hour: number, venue: string, meetingPoint: string) {
  await page.getByLabel('Suggest a different activity').fill(activity)
  await page.getByLabel('Proposed date and time').fill(nextSaturdayAt(hour))
  await page.getByRole('button', { name: 'Use this time' }).click()
  await page.getByLabel('Venue name').fill(venue)
  await page.getByLabel('Public address').fill('Silk Street, London')
  await page.getByLabel('UK postcode').fill('EC2Y 8DS')
  await page.getByLabel('Exact meeting point', { exact: false }).fill(meetingPoint)
  await page.getByLabel(/I confirm this is a public meeting place/i).check()
}

test('a confirmed date stays in place until both members accept its replacement', async ({ browser }) => {
  test.skip(!hasLifecycleEnvironment(), 'Run npm run prepare:staging to create the lifecycle accounts')
  test.setTimeout(120_000)
  const memberA = { id: env('E2E_MEMBER_A_ID'), name: env('E2E_MEMBER_A_NAME'), slug: env('E2E_MEMBER_A_SLUG') }
  const memberB = { id: env('E2E_MEMBER_B_ID'), name: env('E2E_MEMBER_B_NAME'), slug: env('E2E_MEMBER_B_SLUG') }
  await resetRelationshipPair(memberA.id, memberB.id)
  const a = await openMember(browser, 'E2E_MEMBER_A_STATE')
  const b = await openMember(browser, 'E2E_MEMBER_B_STATE')

  try {
    await test.step('the members confirm an initial date', async () => {
      await createMatch(a.page, b.page, memberB, memberA.name)
      await gotoPlanningRoom(a.page, `/plans/${memberB.slug}?new=1`)
      await fillProposal(a.page, 'Pottery painting', 14, 'Barbican Centre', 'Beside the box office')
      await a.page.getByRole('button', { name: `Confirm and send to ${memberB.name}` }).click()
      await gotoPlanningRoom(b.page, `/plans/${memberA.slug}`)
      await b.page.getByRole('button', { name: 'Accept proposal' }).click()
      const confirmed = b.page.getByText('Confirmed date', { exact: true }).locator('xpath=ancestor::section[1]')
      await expect(confirmed.getByText('Pottery painting', { exact: true })).toBeVisible()
    })

    await test.step('A proposes a replacement without erasing the current date', async () => {
      await gotoPlanningRoom(a.page, `/plans/${memberB.slug}`)
      await a.page.getByRole('button', { name: 'Propose a different date' }).click()
      const currentDate = a.page.getByText('Current date — still confirmed', { exact: true })
        .locator('xpath=ancestor::section[1]')
      await expect(currentDate.getByText('Pottery painting', { exact: true })).toBeVisible()
      const proposalPreview = a.page.getByText('Proposal preview', { exact: true })
        .locator('xpath=ancestor::section[1]')
      await expect(proposalPreview).toBeVisible()

      await fillProposal(a.page, 'Sculpture exhibition', 16, 'Barbican Art Gallery', 'At the gallery entrance')
      await proposalPreview.getByRole('button', {
        name: new RegExp(`(?:Send new proposal|Confirm and send) to ${memberB.name}`),
      }).click()
      await expect(a.page).toHaveURL(/\/matches$/)
    })

    await test.step('B sees both plans and deliberately accepts the replacement', async () => {
      await gotoPlanningRoom(b.page, `/plans/${memberA.slug}`)
      const currentDate = b.page.getByText('Current date — still confirmed', { exact: true })
        .locator('xpath=ancestor::section[1]')
      await expect(currentDate.getByText('Pottery painting', { exact: true })).toBeVisible()
      await expect(b.page.getByRole('heading', { name: `${memberA.name} proposed a different date` })).toBeVisible()
      await expect(b.page.getByText('Sculpture exhibition', { exact: true })).toBeVisible()
      await b.page.getByRole('button', { name: 'Accept proposal' }).click()

      const confirmed = b.page.getByText('Confirmed date', { exact: true }).locator('xpath=ancestor::section[1]')
      await expect(confirmed.getByText('Sculpture exhibition', { exact: true })).toBeVisible()
      await expect(confirmed.getByText('Barbican Art Gallery', { exact: true })).toBeVisible()
    })
  } finally {
    await Promise.allSettled([a.context.close(), b.context.close()])
    await resetRelationshipPair(memberA.id, memberB.id)
  }
})
