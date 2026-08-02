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
  const interest = sender.getByRole('button', { name: new RegExp(`Show interest(?: in ${recipient.name})?`, 'i') })
  pageDialog(sender)
  await interest.click()
  await expect(sender.getByText(new RegExp(`Interest sent to ${recipient.name}`, 'i'))).toBeVisible()

  await receiver.goto('/interests/received')
  const card = receiver.locator('article').filter({ hasText: senderName }).first()
  await card.getByRole('button', { name: 'Accept and match' }).click()
  await receiver.getByRole('button', { name: 'Yes, match with them' }).click()
  await expect(receiver.getByText(new RegExp(`You matched with ${senderName}`, 'i'))).toBeVisible()
}

function pageDialog(page: Page) {
  page.once('dialog', dialog => dialog.accept())
}

test.describe('match and date planning release journey', () => {
  test.skip(!hasLifecycleEnvironment(), 'Run npm run prepare:staging to create the lifecycle accounts')
  test.describe.configure({ mode: 'serial' })

  test('two real sessions can match, send a detailed plan, accept it, and cancel clearly', async ({ browser }) => {
    const memberA = { id: env('E2E_MEMBER_A_ID'), name: env('E2E_MEMBER_A_NAME'), slug: env('E2E_MEMBER_A_SLUG') }
    const memberB = { id: env('E2E_MEMBER_B_ID'), name: env('E2E_MEMBER_B_NAME'), slug: env('E2E_MEMBER_B_SLUG') }
    await resetRelationshipPair(memberA.id, memberB.id)
    const a = await openMember(browser, 'E2E_MEMBER_A_STATE')
    const b = await openMember(browser, 'E2E_MEMBER_B_STATE')

    try {
      await test.step('match the two synthetic members', async () => {
        await createMatch(a.page, b.page, memberB, memberA.name)
      })

      await test.step('send a complete proposal using the browser UI', async () => {
        await gotoPlanningRoom(a.page, `/plans/${memberB.slug}?new=1`)
        await a.page.getByLabel('Suggest a different activity').fill('Pottery painting')
        await a.page.getByPlaceholder(/I’d love to try this with you/i).fill('This sounds relaxed and fun.')
        await a.page.getByLabel('Proposed date and time').fill(nextSaturdayAtTwo())
        await a.page.getByRole('button', { name: 'Use this time' }).click()
        await a.page.getByLabel('Venue name').fill('Barbican Centre')
        await a.page.getByLabel('Public address').fill('Silk Street, London')
        await a.page.getByLabel('UK postcode').fill('EC2Y 8DS')
        await a.page.getByLabel('Exact meeting point', { exact: false }).fill('Beside the box office')
        await a.page.getByLabel(/I confirm this is a public meeting place/i).check()
        await a.page.getByRole('button', { name: `Confirm and send to ${memberB.name}` }).click()
        await expect(a.page).toHaveURL(/\/matches$/)
        const matchCard = a.page.locator('article').filter({ hasText: memberB.name }).first()
        await expect(matchCard.getByText('Waiting for a response', { exact: true })).toBeVisible()
        await matchCard.getByRole('link', { name: 'Edit proposal' }).click()
        await expect(a.page.getByRole('heading', { name: `Waiting for ${memberB.name}’s response` })).toBeVisible()
        await expect(a.page.getByText('Pottery painting', { exact: true })).toBeVisible()
        await expect(a.page.getByText('EC2Y 8DS', { exact: true })).toBeVisible()
      })

      await test.step('the recipient reviews and accepts the same details', async () => {
        await gotoPlanningRoom(b.page, `/plans/${memberA.slug}`)
        await expect(b.page.getByRole('heading', { name: `${memberA.name} suggested this date` })).toBeVisible()
        await expect(b.page.getByText('Beside the box office', { exact: false })).toBeVisible()
        await b.page.getByRole('button', { name: 'Accept proposal' }).click()
        await expect(b.page.getByText('Confirmed', { exact: true })).toBeVisible()
      })

      await test.step('cancellation is explicit and visible to both members', async () => {
        await a.page.reload()
        await a.page.getByRole('button', { name: 'Cancel this date' }).click()
        const dialog = a.page.getByRole('alertdialog')
        await expect(dialog.getByText(/remain matched and can make another plan later/i)).toBeVisible()
        await dialog.getByRole('button', { name: 'Yes, cancel date' }).click()
        await expect(a.page).toHaveURL(url =>
          url.pathname === '/matches' && url.searchParams.get('date') === 'cancelled')
        await expect(a.page.getByText(/The date was cancelled and your match was notified/i)).toBeVisible()
        const matchCard = a.page.locator('article').filter({ hasText: memberB.name }).first()
        await expect(matchCard.getByText('Date cancelled — ready to plan again', { exact: true })).toBeVisible()
        await b.page.reload()
        await expect(b.page.getByRole('button', { name: 'Cancel this date' })).toBeHidden()
      })
    } finally {
      await Promise.allSettled([a.context.close(), b.context.close()])
      await resetRelationshipPair(memberA.id, memberB.id)
    }
  })
})
