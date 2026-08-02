import { stagingTarget } from './safety.mjs'

const baseUrl = stagingTarget()
const pages = ['/', '/acceptable-use', '/law-enforcement-guidelines', '/privacy-notice', '/refund-policy']
const vercelBypassSecret = process.env.E2E_VERCEL_BYPASS_SECRET?.trim()

async function get(path) {
  const headers = vercelBypassSecret
    ? { 'x-vercel-protection-bypass': vercelBypassSecret }
    : undefined
  const response = await fetch(new URL(path, baseUrl), { headers, redirect: 'manual' })
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`${path} unexpectedly redirected to ${response.headers.get('location')}`)
  }
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`)
  return response
}

const health = await get('/api/health')
const report = await health.json()
if (report.status !== 'ok') throw new Error(`Staging is not ready: ${report.status}`)
if (report.environment !== 'staging') throw new Error(`Expected staging environment, received ${report.environment}`)
if (report.checks?.deploymentSafety !== 'safe') {
  throw new Error(`Staging safety check failed: ${(report.checks?.deploymentSafetyIssues || []).join('; ')}`)
}
for (const path of pages) await get(path)

console.log(`Staging release gate passed for ${baseUrl.origin}`)
console.log(`Health, database migrations, deployment isolation, and ${pages.length} public routes are ready.`)
