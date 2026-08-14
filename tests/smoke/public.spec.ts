import { expect, test } from '@playwright/test'

test('public landing page loads without server errors', async ({ page }) => {
  const serverErrors: string[] = []
  page.on('response', response => {
    if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`)
  })

  await page.goto('/')
  await expect(page.locator('body')).toBeVisible()
  await expect(page).toHaveTitle(/Intentional dating built around real plans/i)
  expect(serverErrors).toEqual([])
})

test('unauthenticated visitors are sent to the sign-in gate', async ({ page }) => {
  await page.goto('/matches')
  await expect(page).toHaveURL(/\/please-sign-in\?redirect=\/matches$/)
})
