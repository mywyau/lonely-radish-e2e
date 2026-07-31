import { expect, test } from '@playwright/test'
import { hasLifecycleEnvironment } from '../support/env.js'
import { openMember } from '../support/member.js'

test('staging creates a Stripe test-mode Checkout session', async ({ browser }) => {
  test.skip(!hasLifecycleEnvironment(), 'Run npm run prepare:staging to create the lifecycle accounts')
  test.skip(process.env.E2E_RUN_STRIPE_CHECKOUT !== 'true', 'Set E2E_RUN_STRIPE_CHECKOUT=true for the optional Stripe test')
  const session = await openMember(browser, 'E2E_MEMBER_A_STATE')
  try {
    const response = await session.context.request.post('/api/stripe/checkout', { data: { billing: 'monthly' } })
    expect(response.status()).toBe(200)
    const result = await response.json()
    const checkout = new URL(result.url)
    expect(checkout.protocol).toBe('https:')
    expect(checkout.hostname).toMatch(/(^|\.)stripe\.com$/)
  } finally {
    await session.context.close()
  }
})
