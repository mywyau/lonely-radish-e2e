import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import pg from 'pg'
import { databaseSsl, required, stagingDatabaseUrl, stagingTarget } from './safety.mjs'

stagingTarget()
const domain = required('E2E_AUTH0_DOMAIN').replace(/^https?:\/\//, '').replace(/\/+$/, '')
const connection = required('E2E_AUTH0_CONNECTION')
const password = required('E2E_TEST_PASSWORD')
if (password.length < 12) throw new Error('E2E_TEST_PASSWORD must contain at least 12 characters')

const definitions = [
  { key: 'memberA', email: required('E2E_MEMBER_A_EMAIL'), name: 'Staging Alice', firstName: 'Alice', lastName: 'Test', slug: 'staging-alice', complete: true, longitude: -0.1276, latitude: 51.5072 },
  { key: 'memberB', email: required('E2E_MEMBER_B_EMAIL'), name: 'Staging Blair', firstName: 'Blair', lastName: 'Test', slug: 'staging-blair', complete: true, longitude: -0.1180, latitude: 51.5090 },
  { key: 'newMember', email: required('E2E_NEW_MEMBER_EMAIL'), name: 'Staging New Member', firstName: 'New', lastName: 'Member', slug: 'staging-new-member', complete: false },
]

async function managementToken() {
  const response = await fetch(`https://${domain}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: required('E2E_AUTH0_MGMT_CLIENT_ID'),
      client_secret: required('E2E_AUTH0_MGMT_CLIENT_SECRET'),
      audience: `https://${domain}/api/v2/`,
    }),
  })
  if (!response.ok) throw new Error(`Auth0 token request failed with HTTP ${response.status}`)
  return (await response.json()).access_token
}

async function auth0Request(token, path, options = {}) {
  const response = await fetch(`https://${domain}/api/v2${path}`, {
    ...options,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...options.headers },
  })
  if (!response.ok) {
    const detail = await response.text()
    if (response.status === 403 && detail.includes('insufficient_scope')) {
      throw new Error(`Auth0 Management API access is missing a required scope for ${options.method || 'GET'} ${path}. Authorise the staging E2E machine-to-machine application for read:users, create:users, and update:users, then run preparation again.`)
    }
    throw new Error(`Auth0 ${options.method || 'GET'} ${path} failed (${response.status}): ${detail.slice(0, 300)}`)
  }
  return response.status === 204 ? null : response.json()
}

async function ensureAuth0User(token, definition) {
  const matches = await auth0Request(token, `/users-by-email?email=${encodeURIComponent(definition.email)}`)
  const existing = matches.find(user => user.identities?.some(identity => identity.connection === connection))
  if (existing) {
    const userPath = `/users/${encodeURIComponent(existing.user_id)}`
    // Auth0 rejects password and email_verified in the same update, so keep the
    // credential reconciliation separate from the profile/verification update.
    await auth0Request(token, userPath, {
      method: 'PATCH',
      body: JSON.stringify({
        connection,
        password,
      }),
    })
    return auth0Request(token, userPath, {
      method: 'PATCH',
      body: JSON.stringify({
        email_verified: true,
        name: definition.name,
        given_name: definition.firstName,
        family_name: definition.lastName,
      }),
    })
  }
  return auth0Request(token, '/users', {
    method: 'POST',
    body: JSON.stringify({
      connection,
      email: definition.email,
      password,
      email_verified: true,
      name: definition.name,
      given_name: definition.firstName,
      family_name: definition.lastName,
    }),
  })
}

const token = await managementToken()
const accounts = {}
for (const definition of definitions) {
  const user = await ensureAuth0User(token, definition)
  accounts[definition.key] = {
    id: user.user_id,
    email: definition.email,
    name: definition.name,
    slug: definition.slug,
    state: definition.key === 'memberA' ? '.auth/member-a.json'
      : definition.key === 'memberB' ? '.auth/member-b.json' : '.auth/new-member.json',
  }
}

const database = new pg.Client({ connectionString: stagingDatabaseUrl(), ssl: databaseSsl() })
await database.connect()
try {
  await database.query('begin')
  await database.query(`select pg_advisory_xact_lock(hashtext('lonely-radish-staging-seed'))`)
  const migration = await database.query(`select exists(
    select 1 from schema_migrations where filename='20260905_optimize_discovery_interest_capacity.sql'
  ) as current`)
  if (migration.rows[0]?.current !== true) throw new Error('Staging database migrations are not current')

  for (const definition of definitions) {
    const account = accounts[definition.key]
    await database.query('delete from users where lower(email)=lower($1) and id<>$2', [account.email, account.id])
    await database.query(`insert into users(
        id,email,first_name,last_name,role,account_status,timezone,account_type,onboarding_completed_at,
        interest_inbox_reopens_at,paused_at,paused_until,deletion_requested_at,deletion_status,deleted_at
      ) values($1,$2,$3,$4,'member','active','Europe/London','personal',$5,null,null,null,null,null,null)
      on conflict(id) do update set email=excluded.email,first_name=excluded.first_name,last_name=excluded.last_name,
        role='member',account_status='active',timezone='Europe/London',account_type='personal',
        onboarding_completed_at=excluded.onboarding_completed_at,interest_inbox_reopens_at=null,
        paused_at=null,paused_until=null,
        deletion_requested_at=null,deletion_status=null,deleted_at=null,updated_at=now()`,
      [account.id, account.email, definition.firstName, definition.lastName, definition.complete ? new Date() : null])
    await database.query(`insert into entitlements(user_id,plan,subscription_status,cancel_at_period_end)
      values($1,'free','no_subscription',false) on conflict(user_id) do update
      set plan='free',subscription_status='no_subscription',current_period_start=null,current_period_end=null,
        cancel_at_period_end=false,canceled_at=null`, [account.id])

    for (const table of ['profile_photos', 'profile_activities', 'profile_interests', 'availability', 'match_preferences']) {
      await database.query(`delete from ${table} where user_id=$1`, [account.id])
    }
    await database.query('delete from profiles where user_id=$1', [account.id])
    if (!definition.complete) continue

    await database.query(`insert into profiles(
        user_id,slug,display_name,date_of_birth,pronouns,bio,visibility,gender_identity,race_ethnicity,
        sexual_orientation,postcode_area,location_label,location,height_cm,drinking,smoking,daily_rhythm
      ) values($1,$2,$3,'1993-06-15','they/them',
        'Synthetic staging profile used only for release checks. I like easy conversation and unhurried plans.',
        'active','neither','White','bisexual','EC1','Central London',
        extensions.ST_SetSRID(extensions.ST_MakePoint($4,$5),4326)::extensions.geography,
        170,'socially','never','flexible')`,
      [account.id, account.slug, account.name, definition.longitude, definition.latitude])
    const photo = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='1000'%3E%3Crect width='100%25' height='100%25' fill='%23e9d5c2'/%3E%3Ccircle cx='400' cy='350' r='160' fill='%23b4234a'/%3E%3Cpath d='M130 920c45-220 495-220 540 0' fill='%23b4234a'/%3E%3C/svg%3E`
    await database.query(`insert into profile_photos(user_id,public_url,alt_text,position)
      values($1,$2,$3,1)`, [account.id, photo, `${account.name} synthetic test portrait`])
    await database.query(`insert into profile_activities(user_id,activity_id,position)
      select $1,id,1 from activities where lower(name)=lower('Gallery walks') limit 1`, [account.id])
    await database.query(`insert into profile_activities(user_id,activity_id,position)
      select $1,id,2 from activities where lower(name)=lower('Museums') limit 1`, [account.id])
    await database.query(`insert into profile_interests(user_id,label,position)
      values($1,'Independent cafés',1),($1,'Weekend wandering',2)`, [account.id])
    await database.query(`insert into availability(user_id,label,position,weekday,start_time,end_time)
      values($1,'Saturday afternoons',1,5,'13:00','18:00')`, [account.id])
    await database.query(`insert into match_preferences(
        user_id,max_distance_km,minimum_age,maximum_age,timing,public_places_only,interested_genders,
        open_to_everyone,preferred_ethnicities,no_ethnicity_preference,dating_preferences_set,
        availability_visible_before_match,interested_orientations,no_orientation_preference
      ) values($1,100,18,80,array['Weekends'],true,'{}',true,'{}',true,true,true,array['bisexual'],false)
      on conflict(user_id) do update set max_distance_km=100,minimum_age=18,maximum_age=80,
        timing=array['Weekends'],public_places_only=true,interested_genders='{}',open_to_everyone=true,
        preferred_ethnicities='{}',no_ethnicity_preference=true,dating_preferences_set=true,
        availability_visible_before_match=true,interested_orientations=array['bisexual'],
        no_orientation_preference=false,updated_at=now()`, [account.id])
  }
  const pair = [accounts.memberA.id, accounts.memberB.id]
  await database.query(`delete from notifications where
    (actor_id=$1 and recipient_id=$2) or (actor_id=$2 and recipient_id=$1)`, pair)
  await database.query(`delete from daily_interests where
    (sender_id=$1 and recipient_id=$2) or (sender_id=$2 and recipient_id=$1)`, pair)
  await database.query(`delete from blocks where
    (blocker_id=$1 and blocked_id=$2) or (blocker_id=$2 and blocked_id=$1)`, pair)
  await database.query(`delete from reports where
    (reporter_id=$1 and reported_id=$2) or (reporter_id=$2 and reported_id=$1)`, pair)
  await database.query(`delete from matches where
    (user_one_id=$1 and user_two_id=$2) or (user_one_id=$2 and user_two_id=$1)`, pair)
  await database.query('commit')
} catch (error) {
  await database.query('rollback')
  throw error
} finally {
  await database.end()
}

const manifestPath = resolve(process.cwd(), process.env.E2E_SEED_MANIFEST || '.auth/staging-users.json')
await mkdir(dirname(manifestPath), { recursive: true })
await writeFile(manifestPath, `${JSON.stringify({ version: 1, target: stagingTarget().origin, accounts }, null, 2)}\n`, { mode: 0o600 })
console.log(`Staging accounts and profiles are ready. Manifest written to ${manifestPath}`)
