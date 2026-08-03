import type { Page } from '@playwright/test'

function nextSaturdayAt(hour: number) {
  const result = new Date()
  const days = (6 - result.getDay() + 7) % 7 || 7
  result.setDate(result.getDate() + days)
  result.setHours(hour, 0, 0, 0)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${result.getFullYear()}-${pad(result.getMonth() + 1)}-${pad(result.getDate())}T${pad(hour)}:00`
}

export async function chooseCustomProposalTime(page: Page, hour: number) {
  await page.getByLabel('Choose another date and time').fill(nextSaturdayAt(hour), { timeout: 10_000 })
  await page.getByRole('button', { name: 'Use this time' }).click({ timeout: 10_000 })
}
