import 'dotenv/config'

export function required(name) {
  const result = process.env[name]?.trim()
  if (!result) throw new Error(`${name} is required`)
  return result
}

export function stagingTarget() {
  if (required('E2E_TARGET_ENV') !== 'staging') throw new Error('E2E_TARGET_ENV must be exactly staging')
  const baseUrl = new URL(required('E2E_BASE_URL'))
  if (baseUrl.protocol !== 'https:') throw new Error('E2E_BASE_URL must use HTTPS')
  if (baseUrl.pathname !== '/' || baseUrl.search || baseUrl.hash) {
    throw new Error('E2E_BASE_URL must be an origin without a path')
  }
  if (baseUrl.hostname !== required('E2E_ALLOWED_HOST')) {
    throw new Error('E2E_ALLOWED_HOST does not match E2E_BASE_URL')
  }
  const production = process.env.E2E_PRODUCTION_URL?.trim()
  if (production && new URL(production).origin === baseUrl.origin) {
    throw new Error('Refusing to run because E2E_BASE_URL matches E2E_PRODUCTION_URL')
  }
  return baseUrl
}

export function stagingDatabaseUrl() {
  stagingTarget()
  if (process.env.E2E_ALLOW_DATABASE_RESET !== 'true') {
    throw new Error('E2E_ALLOW_DATABASE_RESET must be exactly true for staging database writes')
  }
  const databaseUrl = new URL(required('E2E_DATABASE_URL'))
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
    throw new Error('E2E_DATABASE_URL must be a PostgreSQL URL')
  }
  if (databaseUrl.hostname !== required('E2E_EXPECTED_DATABASE_HOST')) {
    throw new Error('E2E_EXPECTED_DATABASE_HOST does not match E2E_DATABASE_URL')
  }
  const expectedRef = required('E2E_EXPECTED_DATABASE_PROJECT_REF').toLowerCase()
  const directRef = databaseUrl.hostname.match(/^db\.([a-z0-9-]+)\.supabase\.co$/i)?.[1]
  const pooledRef = decodeURIComponent(databaseUrl.username).match(/^postgres\.([a-z0-9-]+)$/i)?.[1]
  if ((directRef || pooledRef)?.toLowerCase() !== expectedRef) {
    throw new Error('E2E database does not match E2E_EXPECTED_DATABASE_PROJECT_REF')
  }
  return databaseUrl.toString()
}

export function databaseSsl() {
  return process.env.E2E_DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
}
