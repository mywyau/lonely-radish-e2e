import { expect, test } from '@playwright/test'

test('the deployed staging application reports that it is safe and ready', async ({ request }) => {
  test.skip(process.env.E2E_TARGET_ENV !== 'staging', 'This release gate only runs against staging')
  const response = await request.get('/api/health')
  const health = await response.json()
  expect(response.status(), `Staging health response: ${JSON.stringify(health)}`).toBe(200)
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
