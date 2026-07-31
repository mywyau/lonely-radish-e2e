import { expect, test } from '@playwright/test'

test('the deployed staging application reports that it is safe and ready', async ({ request }) => {
  test.skip(process.env.E2E_TARGET_ENV !== 'staging', 'This release gate only runs against staging')
  const response = await request.get('/api/health')
  expect(response.status()).toBe(200)
  const health = await response.json()
  expect(health).toMatchObject({
    status: 'ok',
    environment: 'staging',
    checks: {
      database: 'connected',
      migrations: 'current',
      deploymentSafety: 'safe',
    },
  })
  expect(health.checks.deploymentSafetyIssues).toEqual([])
})
