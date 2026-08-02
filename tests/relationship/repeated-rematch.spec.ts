import { expect, test, type Page } from '@playwright/test'
import { reopenInterestInbox, resetRelationshipPair } from '../support/database.js'
import { env, hasLifecycleEnvironment } from '../support/env.js'
import { openMember } from '../support/member.js'

async function sendInterest(page: Page, recipientSlug: string, recipientName: string) {
  await page.goto(`/profiles/${recipientSlug}`)
  const button = page.getByRole('button', { name: new RegExp(`Show interest(?: in ${recipientName})?(?: again)?`, 'i') })
  await expect(button).toBeEnabled()
  page.once('dialog', dialog => dialog.accept())
  await button.click()
  await expect(page.getByText(new RegExp(`Interest sent to ${recipientName}`, 'i'))).toBeVisible()
}

async function acceptInterest(page: Page, senderName: string) {
  await page.goto('/interests/received')
  const card = page.locator('article').filter({ hasText: senderName }).first()
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: 'Accept and match' }).click()
  await page.getByRole('button', { name: 'Yes, match with them' }).click()
  await expect(page.getByText(new RegExp(`You matched with ${senderName}`, 'i'))).toBeVisible()
}

async function removeMatch(page: Page, otherName: string) {
  await page.goto('/matches')
  const card = page.locator('article').filter({ hasText: otherName }).first()
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: 'Remove match' }).click()
  await page.getByRole('button', { name: 'Yes, remove match' }).click()
  await expect(card).toBeHidden()
}

async function sendApology(page: Page, recipientSlug: string) {
  await page.goto(`/profiles/${recipientSlug}?connection=past`)
  const form = page.locator('form').filter({ hasText: 'Send a private message for this ended match' })
  await form.locator('textarea').fill('I am sorry for ending our match abruptly. I would still like to reconnect.')
  await form.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByText('You can now show interest again.')).toBeVisible()
}

test.describe('repeated second-chance lifecycle', () => {
  test.skip(!hasLifecycleEnvironment(), 'Configure the two lifecycle accounts and isolated E2E database')
  test.describe.configure({ mode: 'serial' })

  test('the same pair can match, unmatch and rematch more than once', async ({ browser }) => {
    const memberA = {
      id: env('E2E_MEMBER_A_ID'),
      name: env('E2E_MEMBER_A_NAME'),
      slug: env('E2E_MEMBER_A_SLUG'),
    }
    const memberB = {
      id: env('E2E_MEMBER_B_ID'),
      name: env('E2E_MEMBER_B_NAME'),
      slug: env('E2E_MEMBER_B_SLUG'),
    }
    await resetRelationshipPair(memberA.id, memberB.id)

    const a = await openMember(browser, 'E2E_MEMBER_A_STATE')
    const b = await openMember(browser, 'E2E_MEMBER_B_STATE')
    try {
      await test.step('first match', async () => {
        await sendInterest(a.page, memberB.slug, memberB.name)
        await acceptInterest(b.page, memberA.name)
      })

      await test.step('A ends the match and earns a second chance', async () => {
        await removeMatch(a.page, memberB.name)
        await sendApology(a.page, memberB.slug)
        // Accepting an interest deliberately paces the recipient's inbox until
        // the next local day. Advance that test state before exercising rematch.
        await reopenInterestInbox(memberB.id)
        await sendInterest(a.page, memberB.slug, memberB.name)
        await acceptInterest(b.page, memberA.name)
      })

      await test.step('B ends the rematch and the pair can match a third time', async () => {
        await removeMatch(b.page, memberA.name)
        await sendApology(b.page, memberA.slug)
        await sendInterest(b.page, memberA.slug, memberA.name)
        await acceptInterest(a.page, memberB.name)
      })

      await expect(a.page.getByText(new RegExp(`You matched with ${memberB.name}`, 'i'))).toBeVisible()
    } finally {
      await Promise.allSettled([a.context.close(), b.context.close()])
    }
  })
})
