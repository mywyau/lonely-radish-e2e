import { expect, test, type Page } from '@playwright/test'
import { resetRelationshipPair } from '../support/database.js'
import { env, hasLifecycleEnvironment } from '../support/env.js'
import { openMember } from '../support/member.js'

async function sendInterest(page: Page, recipientSlug: string, recipientName: string) {
  await page.goto(`/profiles/${recipientSlug}`)
  const button = page.getByRole('button', {
    name: new RegExp(`(?:Show interest(?: in ${recipientName})?(?: again)?|Ask ${recipientName} to reconnect)`, 'i'),
  })
  await expect(button).toBeEnabled()
  page.once('dialog', dialog => dialog.accept())
  await button.click()
  await expect(page.getByText(new RegExp(`Interest sent to ${recipientName}`, 'i'))).toBeVisible()
}

async function acceptInterest(page: Page, senderName: string) {
  const received = page.waitForResponse(response => response.request().method() === 'GET'
    && new URL(response.url()).pathname === '/api/interests/received')
  await page.goto('/interests/received')
  const response = await received
  expect(response.ok(), await response.text()).toBe(true)
  const card = page.locator('article').filter({ hasText: senderName }).first()
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: /Accept and (?:match|reconnect)/ }).click()
  await page.getByRole('button', { name: /Yes, (?:match with them|reconnect)/ }).click()
  await expect(page.getByText(new RegExp(`You (?:matched|reconnected) with ${senderName}`, 'i'))).toBeVisible()
}

async function expectReconnectContext(page: Page, senderName: string, note: string) {
  await page.goto('/matches/past')
  const pastConnection = page.locator('article').filter({ hasText: senderName }).first()
  await expect(pastConnection).toContainText(`Note received from ${senderName}`)
  await expect(pastConnection).toContainText(note)
  await expect(pastConnection).toContainText('Reconnect request pending')
  await expect(pastConnection.getByRole('link', { name: 'Review reconnect request' })).toBeVisible()

  await page.goto('/interests/received')
  const request = page.locator('article').filter({ hasText: senderName }).first()
  await expect(request).toContainText('Reconnect request')
  await expect(request).toContainText(note)
  await expect(request.getByRole('button', { name: 'Accept and reconnect' })).toBeVisible()
  await expect(request.getByRole('button', { name: 'Do not reconnect' })).toBeVisible()
}

async function declineAndUndoReconnect(page: Page, senderName: string) {
  const request = page.locator('article').filter({ hasText: senderName }).first()
  const dialogPromise = page.waitForEvent('dialog')
  const decline = request.getByRole('button', { name: 'Do not reconnect' }).click()
  const dialog = await dialogPromise
  expect(dialog.message()).toBe(`Decide not to reconnect with ${senderName}? You will have 30 seconds to undo.`)
  await dialog.accept()
  await decline

  const undoNotice = page.getByRole('status').filter({
    has: page.getByRole('button', { name: 'Undo' }),
    hasText: `You chose not to reconnect with ${senderName}.`,
  })
  await expect(undoNotice).toBeVisible()
  const restored = page.waitForResponse(response => response.request().method() === 'POST'
    && /\/api\/interests\/[^/]+\/undo$/.test(new URL(response.url()).pathname))
  await undoNotice.getByRole('button', { name: 'Undo' }).click()
  expect((await restored).ok()).toBe(true)
  await expect(request).toBeVisible()
}

async function removeMatch(page: Page, otherName: string) {
  await page.goto('/matches')
  const card = page.locator('article').filter({ hasText: otherName }).first()
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: 'Close connection' }).click()
  const closed = page.waitForResponse(response => response.request().method() === 'DELETE'
    && /\/api\/matches\/[^/]+$/.test(new URL(response.url()).pathname))
  await page.getByRole('button', { name: 'Yes, close connection' }).click()
  expect((await closed).ok()).toBe(true)
  await expect(card).toBeHidden()
}

async function sendApology(page: Page, recipientSlug: string) {
  await page.goto(`/profiles/${recipientSlug}?connection=past`)
  const form = page.locator('form').filter({ hasText: 'Send a note before asking to reconnect' })
  await form.locator('textarea').fill('I am sorry for ending our match abruptly. I would still like to reconnect.')
  await form.getByRole('button', { name: 'Send note' }).click()
  await expect(page.getByText(/Your note was sent/)).toBeVisible()
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
        await sendInterest(a.page, memberB.slug, memberB.name)
        await expectReconnectContext(b.page,memberA.name,
          'I am sorry for ending our match abruptly. I would still like to reconnect.')
        await declineAndUndoReconnect(b.page,memberA.name)
        await acceptInterest(b.page, memberA.name)
      })

      await test.step('B ends the rematch and the pair can match a third time', async () => {
        await removeMatch(b.page, memberA.name)
        await sendApology(b.page, memberA.slug)
        await sendInterest(b.page, memberA.slug, memberA.name)
        await expectReconnectContext(a.page,memberB.name,
          'I am sorry for ending our match abruptly. I would still like to reconnect.')
        await acceptInterest(a.page, memberB.name)
      })

      await expect(a.page.getByText(new RegExp(`You (?:matched|reconnected) with ${memberB.name}`, 'i'))).toBeVisible()
    } finally {
      await Promise.allSettled([a.context.close(), b.context.close()])
      await resetRelationshipPair(memberA.id, memberB.id)
    }
  })
})
