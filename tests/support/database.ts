import pg from 'pg'
import { assertStagingDatabaseTarget, env } from './env.js'

const interestInboxFixtureIds = Array.from({ length: 5 }, (_, index) =>
  `e2e-interest-inbox-sender-${index + 1}`)
const dailyLimitFixtureIds = Array.from({ length: 5 }, (_, index) =>
  `e2e-daily-limit-recipient-${index + 1}`)
const activeMatchFixtureIds = Array.from({ length: 3 }, (_, index) =>
  `e2e-active-match-person-${index + 1}`)
const queuedMatchFixtureIds = Array.from({ length: 2 }, (_, index) =>
  `e2e-queued-match-person-${index + 1}`)
const matchLimitFixtureIds = [...activeMatchFixtureIds, ...queuedMatchFixtureIds]

function databaseClient(): pg.Client {
  return new pg.Client({
    connectionString: env('E2E_DATABASE_URL'),
    ssl: process.env.E2E_DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  })
}

export type PublicProfileIdentity = {
  genderIdentity: 'man' | 'woman' | 'neither'
  pronouns: string | null
  updatedAt: string
}

export async function publicProfileIdentity(userId: string): Promise<PublicProfileIdentity> {
  assertStagingDatabaseTarget()
  const client = databaseClient()
  await client.connect()
  try {
    const { rows } = await client.query<PublicProfileIdentity>(`select
      gender_identity as "genderIdentity",pronouns,updated_at::text as "updatedAt"
      from profiles where user_id=$1`, [userId])
    if (!rows[0]) throw new Error(`Profile not found for staging user ${userId}`)
    return rows[0]
  } finally {
    await client.end()
  }
}

export async function restorePublicProfileIdentity(
  userId: string,
  identity: PublicProfileIdentity,
): Promise<void> {
  assertStagingDatabaseTarget()
  const client = databaseClient()
  await client.connect()
  try {
    await client.query('begin')
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`e2e-profile-identity:${userId}`])
    const result = await client.query(`update profiles set gender_identity=$2,pronouns=$3,updated_at=$4::timestamptz
      where user_id=$1`, [userId, identity.genderIdentity, identity.pronouns, identity.updatedAt])
    if (result.rowCount !== 1) throw new Error(`Profile not found for staging user ${userId}`)
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    await client.end()
  }
}

export type ProfileDetailsSnapshot = {
  bio: string | null
  heightCm: number | null
  weightKg: number | null
  drinking: string | null
  smoking: string | null
  dailyRhythm: string | null
  updatedAt: string
}

export async function profileDetailsSnapshot(userId: string): Promise<ProfileDetailsSnapshot> {
  assertStagingDatabaseTarget()
  const client = databaseClient()
  await client.connect()
  try {
    const { rows } = await client.query<ProfileDetailsSnapshot>(`select bio,height_cm as "heightCm",
      weight_kg as "weightKg",drinking,smoking,daily_rhythm as "dailyRhythm",updated_at::text as "updatedAt"
      from profiles where user_id=$1`, [userId])
    if (!rows[0]) throw new Error(`Profile not found for staging user ${userId}`)
    return rows[0]
  } finally {
    await client.end()
  }
}

export async function restoreProfileDetails(userId: string, snapshot: ProfileDetailsSnapshot): Promise<void> {
  assertStagingDatabaseTarget()
  const client = databaseClient()
  await client.connect()
  try {
    const result = await client.query(`update profiles set bio=$2,height_cm=$3,weight_kg=$4,drinking=$5,
      smoking=$6,daily_rhythm=$7,updated_at=$8::timestamptz where user_id=$1`,
    [userId,snapshot.bio,snapshot.heightCm,snapshot.weightKg,snapshot.drinking,snapshot.smoking,
      snapshot.dailyRhythm,snapshot.updatedAt])
    if (result.rowCount !== 1) throw new Error(`Profile not found for staging user ${userId}`)
  } finally {
    await client.end()
  }
}

export type ActivityPreferenceSnapshot = Array<{
  id: string
  activityId: string | null
  customLabel: string | null
  customCategory: string | null
  position: number
  createdAt: string
}>

export async function activityPreferenceSnapshot(userId: string): Promise<ActivityPreferenceSnapshot> {
  assertStagingDatabaseTarget()
  const client = databaseClient()
  await client.connect()
  try {
    const { rows } = await client.query(`select id,activity_id::text as "activityId",
      custom_label as "customLabel",custom_category as "customCategory",position,
      created_at::text as "createdAt" from profile_activities where user_id=$1 order by position`, [userId])
    return rows
  } finally {
    await client.end()
  }
}

export async function restoreActivityPreferences(userId: string, snapshot: ActivityPreferenceSnapshot): Promise<void> {
  assertStagingDatabaseTarget()
  const client = databaseClient()
  await client.connect()
  try {
    await client.query('begin')
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`e2e-activities:${userId}`])
    await client.query('delete from profile_activities where user_id=$1', [userId])
    for (const row of snapshot) {
      await client.query(`insert into profile_activities(
        id,user_id,activity_id,custom_label,custom_category,position,created_at
      ) values($1,$2,$3::bigint,$4,$5,$6,$7::timestamptz)`,
      [row.id,userId,row.activityId,row.customLabel,row.customCategory,row.position,row.createdAt])
    }
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    await client.end()
  }
}

export type DatingPreferenceSnapshot = {
  genders: string[]
  openToEveryone: boolean
  orientations: string[]
  noOrientationPreference: boolean
  raceEthnicities: string[]
  noRaceEthnicityPreference: boolean
  datingPreferencesSet: boolean
  updatedAt: string
} | null

export async function datingPreferenceSnapshot(userId: string): Promise<DatingPreferenceSnapshot> {
  assertStagingDatabaseTarget()
  const client = databaseClient()
  await client.connect()
  try {
    const { rows } = await client.query(`select interested_genders as genders,
      open_to_everyone as "openToEveryone",interested_orientations as orientations,
      no_orientation_preference as "noOrientationPreference",preferred_ethnicities as "raceEthnicities",
      no_ethnicity_preference as "noRaceEthnicityPreference",dating_preferences_set as "datingPreferencesSet",
      updated_at::text as "updatedAt" from match_preferences where user_id=$1`, [userId])
    return rows[0] || null
  } finally {
    await client.end()
  }
}

export async function restoreDatingPreferences(userId: string, snapshot: DatingPreferenceSnapshot): Promise<void> {
  assertStagingDatabaseTarget()
  const client = databaseClient()
  await client.connect()
  try {
    if (!snapshot) {
      await client.query('delete from match_preferences where user_id=$1', [userId])
      return
    }
    await client.query(`insert into match_preferences(user_id,interested_genders,open_to_everyone,
      interested_orientations,no_orientation_preference,preferred_ethnicities,no_ethnicity_preference,
      dating_preferences_set,updated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz)
      on conflict(user_id) do update set interested_genders=excluded.interested_genders,
      open_to_everyone=excluded.open_to_everyone,interested_orientations=excluded.interested_orientations,
      no_orientation_preference=excluded.no_orientation_preference,
      preferred_ethnicities=excluded.preferred_ethnicities,
      no_ethnicity_preference=excluded.no_ethnicity_preference,
      dating_preferences_set=excluded.dating_preferences_set,updated_at=excluded.updated_at`,
    [userId,snapshot.genders,snapshot.openToEveryone,snapshot.orientations,snapshot.noOrientationPreference,
      snapshot.raceEthnicities,snapshot.noRaceEthnicityPreference,snapshot.datingPreferencesSet,snapshot.updatedAt])
  } finally {
    await client.end()
  }
}

export type NotificationManagementSnapshot = {
  notifications: Array<{
    id: string
    actorId: string | null
    matchId: string | null
    proposalId: string | null
    kind: string
    readAt: string | null
    createdAt: string
    sourceOutboxEventId: string | null
  }>
  emailDeliveries: Array<{
    id: string
    notificationId: string
    kind: string
    status: string
    attempts: number
    providerId: string | null
    lastError: string | null
    nextAttemptAt: string
    createdAt: string
    sentAt: string | null
  }>
  emailPreferences: {
    interests: boolean
    matches: boolean
    datePlans: boolean
    followUps: boolean
    unsubscribeToken: string
    updatedAt: string
  } | null
}

export async function seedNotificationManagementFixtures(
  recipientId: string,
  actorId: string,
): Promise<NotificationManagementSnapshot> {
  assertStagingDatabaseTarget()
  const client = databaseClient()
  await client.connect()
  try {
    await client.query('begin')
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`e2e-notifications:${recipientId}`])
    const notifications = await client.query(`select id,actor_id as "actorId",match_id as "matchId",
      proposal_id as "proposalId",kind,read_at::text as "readAt",created_at::text as "createdAt",
      source_outbox_event_id::text as "sourceOutboxEventId" from notifications where recipient_id=$1`, [recipientId])
    const deliveries = await client.query(`select id::text,notification_id as "notificationId",kind,status,
      attempts,provider_id as "providerId",last_error as "lastError",next_attempt_at::text as "nextAttemptAt",
      created_at::text as "createdAt",sent_at::text as "sentAt" from email_deliveries
      where recipient_id=$1`, [recipientId])
    const preferences = await client.query(`select interests,matches,date_plans as "datePlans",
      follow_ups as "followUps",unsubscribe_token::text as "unsubscribeToken",updated_at::text as "updatedAt"
      from email_notification_preferences where user_id=$1`, [recipientId])
    await client.query(`insert into email_notification_preferences(user_id,interests,matches,date_plans,follow_ups)
      values($1,false,false,false,false) on conflict(user_id) do update set
      interests=false,matches=false,date_plans=false,follow_ups=false,updated_at=now()`, [recipientId])
    await client.query('delete from notifications where recipient_id=$1', [recipientId])
    await client.query(`insert into notifications(recipient_id,actor_id,kind,created_at) values
      ($1,$2,'interest_received',now()-interval '2 minutes'),($1,$2,'new_match',now()-interval '1 minute')`,
    [recipientId,actorId])
    await client.query('commit')
    return { notifications: notifications.rows, emailDeliveries: deliveries.rows,
      emailPreferences: preferences.rows[0] || null }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    await client.end()
  }
}

export async function restoreNotificationManagementFixtures(
  recipientId: string,
  snapshot: NotificationManagementSnapshot,
): Promise<void> {
  assertStagingDatabaseTarget()
  const client = databaseClient()
  await client.connect()
  try {
    await client.query('begin')
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`e2e-notifications:${recipientId}`])
    await client.query('delete from notifications where recipient_id=$1', [recipientId])
    for (const row of snapshot.notifications) {
      await client.query(`insert into notifications(id,recipient_id,actor_id,match_id,proposal_id,kind,
        read_at,created_at,source_outbox_event_id) values($1,$2,$3,$4::uuid,$5::uuid,$6,$7::timestamptz,
        $8::timestamptz,$9::bigint)`, [row.id,recipientId,row.actorId,row.matchId,row.proposalId,row.kind,
        row.readAt,row.createdAt,row.sourceOutboxEventId])
    }
    await client.query('delete from email_deliveries where recipient_id=$1', [recipientId])
    for (const row of snapshot.emailDeliveries) {
      await client.query(`insert into email_deliveries(id,notification_id,recipient_id,kind,status,attempts,
        provider_id,last_error,next_attempt_at,created_at,sent_at) values($1::bigint,$2,$3,$4,$5,$6,$7,$8,
        $9::timestamptz,$10::timestamptz,$11::timestamptz)`, [row.id,row.notificationId,recipientId,row.kind,
        row.status,row.attempts,row.providerId,row.lastError,row.nextAttemptAt,row.createdAt,row.sentAt])
    }
    if (snapshot.emailPreferences) {
      const preference = snapshot.emailPreferences
      await client.query(`insert into email_notification_preferences(user_id,interests,matches,date_plans,
        follow_ups,unsubscribe_token,updated_at) values($1,$2,$3,$4,$5,$6::uuid,$7::timestamptz)
        on conflict(user_id) do update set interests=excluded.interests,matches=excluded.matches,
        date_plans=excluded.date_plans,follow_ups=excluded.follow_ups,
        unsubscribe_token=excluded.unsubscribe_token,updated_at=excluded.updated_at`,
      [recipientId,preference.interests,preference.matches,preference.datePlans,preference.followUps,
        preference.unsubscribeToken,preference.updatedAt])
    } else {
      await client.query('delete from email_notification_preferences where user_id=$1', [recipientId])
    }
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    await client.end()
  }
}

export async function resetRelationshipPair(userA: string, userB: string): Promise<void> {
  assertStagingDatabaseTarget()
  const client = databaseClient()
  await client.connect()
  try {
    await client.query('begin')
    await client.query(`update users set interest_inbox_reopens_at=null where id=$1 or id=$2`, [userA, userB])
    await client.query(`delete from notifications where
      (actor_id=$1 and recipient_id=$2) or (actor_id=$2 and recipient_id=$1)`, [userA, userB])
    await client.query(`delete from outbox_events where
      (payload->>'senderId'=$1 and payload->>'recipientId'=$2)
      or (payload->>'senderId'=$2 and payload->>'recipientId'=$1)
      or (payload->>'userOneId' in ($1,$2) and payload->>'userTwoId' in ($1,$2))`, [userA, userB])
    // These are dedicated lifecycle accounts. Clear all of their outgoing
    // interests so daily limits and prior interrupted runs cannot affect a test.
    await client.query(`delete from daily_interests where sender_id=$1 or sender_id=$2`, [userA, userB])
    await client.query(`delete from blocks where
      (blocker_id=$1 and blocked_id=$2) or (blocker_id=$2 and blocked_id=$1)`, [userA, userB])
    await client.query(`delete from reports where
      (reporter_id=$1 and reported_id=$2) or (reporter_id=$2 and reported_id=$1)`, [userA, userB])
    await client.query(`delete from matches where
      (user_one_id=$1 and user_two_id=$2) or (user_one_id=$2 and user_two_id=$1)`, [userA, userB])
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    await client.end()
  }
}

export async function reopenInterestInbox(userId: string): Promise<void> {
  assertStagingDatabaseTarget()
  const client = databaseClient()
  await client.connect()
  try {
    await client.query('update users set interest_inbox_reopens_at=null where id=$1', [userId])
  } finally {
    await client.end()
  }
}

export async function resetNewMemberOnboarding(userId: string): Promise<void> {
  assertStagingDatabaseTarget()
  const client = databaseClient()
  await client.connect()
  try {
    await client.query('begin')
    for (const table of ['profile_photos', 'profile_activities', 'profile_interests', 'availability', 'match_preferences', 'profile_contact_details']) {
      await client.query(`delete from ${table} where user_id=$1`, [userId])
    }
    await client.query('delete from profiles where user_id=$1', [userId])
    await client.query(`update users set onboarding_completed_at=null,account_status='active',
      interest_inbox_reopens_at=null,paused_at=null,paused_until=null where id=$1`, [userId])
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    await client.end()
  }
}

export async function clearContactDetails(userId: string): Promise<void> {
  assertStagingDatabaseTarget()
  const client = databaseClient()
  await client.connect()
  try {
    await client.query('delete from profile_contact_details where user_id=$1', [userId])
  } finally {
    await client.end()
  }
}

export async function waitForNotification(
  recipientId: string,
  actorId: string,
  kind: string,
  timeoutMs = 20_000,
): Promise<void> {
  assertStagingDatabaseTarget()
  const client = databaseClient()
  await client.connect()
  const deadline = Date.now() + timeoutMs
  try {
    while (Date.now() < deadline) {
      const result = await client.query(`select exists(select 1 from notifications
        where recipient_id=$1 and actor_id=$2 and kind=$3) as ready`, [recipientId,actorId,kind])
      if (result.rows[0]?.ready === true) return
      await new Promise(resolve => setTimeout(resolve,500))
    }
    const outbox = await client.query(`select status,attempts,last_error from outbox_events
      where event_type='interest.sent' and payload->>'senderId'=$2 and payload->>'recipientId'=$1
      order by id desc limit 1`, [recipientId,actorId])
    throw new Error(`Notification ${kind} was not delivered within ${timeoutMs}ms; outbox=${JSON.stringify(outbox.rows[0] || null)}`)
  } finally {
    await client.end()
  }
}

export type EligibilityScenario =
  | 'compatible'
  | 'sender-age'
  | 'recipient-age'
  | 'recipient-gender'
  | 'recipient-orientation'
  | 'distance'

export async function configureEligibilityScenario(
  senderId: string,
  recipientId: string,
  scenario: EligibilityScenario,
): Promise<void> {
  assertStagingDatabaseTarget()
  const client = databaseClient()
  await client.connect()
  try {
    await client.query('begin')
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`,
      [[senderId, recipientId].sort().join(':')])
    await client.query(`update profiles set
      date_of_birth='1993-06-15',gender_identity='neither',sexual_orientation='bisexual',
      location=case when user_id=$1
        then extensions.ST_SetSRID(extensions.ST_MakePoint(-0.1276,51.5072),4326)::extensions.geography
        else extensions.ST_SetSRID(extensions.ST_MakePoint(-0.1180,51.5090),4326)::extensions.geography end
      where user_id=$1 or user_id=$2`, [senderId, recipientId])
    await client.query(`update match_preferences set
      max_distance_km=100,minimum_age=18,maximum_age=80,
      interested_genders='{}',open_to_everyone=true,
      interested_orientations=array['bisexual'],no_orientation_preference=false,
      preferred_ethnicities='{}',no_ethnicity_preference=true,updated_at=now()
      where user_id=$1 or user_id=$2`, [senderId, recipientId])

    if (scenario === 'sender-age') {
      await client.query('update match_preferences set maximum_age=25 where user_id=$1', [senderId])
    } else if (scenario === 'recipient-age') {
      await client.query('update match_preferences set minimum_age=60 where user_id=$1', [recipientId])
    } else if (scenario === 'recipient-gender') {
      await client.query(`update match_preferences set open_to_everyone=false,
        interested_genders=array['Women'] where user_id=$1`, [recipientId])
    } else if (scenario === 'recipient-orientation') {
      await client.query(`update match_preferences set no_orientation_preference=false,
        interested_orientations=array['straight'] where user_id=$1`, [recipientId])
    } else if (scenario === 'distance') {
      await client.query(`update profiles set
        location=extensions.ST_SetSRID(extensions.ST_MakePoint(-3.1883,55.9533),4326)::extensions.geography
        where user_id=$1`, [recipientId])
    }
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    await client.end()
  }
}

export async function seedInterestInbox(recipientId: string, count = 5): Promise<string[]> {
  if (!Number.isInteger(count) || count < 1 || count > interestInboxFixtureIds.length) {
    throw new Error('Interest inbox fixture count must be between 1 and 5')
  }
  assertStagingDatabaseTarget()
  const client = databaseClient()
  await client.connect()
  try {
    await client.query('begin')
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`e2e-interest-inbox:${recipientId}`])
    await client.query('delete from daily_interests where recipient_id=$1', [recipientId])
    await client.query('delete from users where id=any($1::text[])', [interestInboxFixtureIds])
    await client.query('update users set interest_inbox_reopens_at=null where id=$1', [recipientId])

    for (const [index, userId] of interestInboxFixtureIds.slice(0, count).entries()) {
      const number = index + 1
      await client.query(`insert into users(
          id,email,first_name,last_name,role,account_status,timezone,account_type,onboarding_completed_at
        ) values($1,$2,$3,'Fixture','member','active','Europe/London','personal',now())`,
      [userId, `interest-inbox-${number}@e2e.invalid`, `Inbox ${number}`])
      await client.query(`insert into profiles(
          user_id,slug,display_name,date_of_birth,pronouns,bio,visibility,gender_identity,
          race_ethnicity,sexual_orientation,postcode_area,location_label,location
        ) values($1,$2,$3,'1993-06-15','they/them','Synthetic interest inbox fixture.',
          'active','neither','White','bisexual','EC1','Central London',
          extensions.ST_SetSRID(extensions.ST_MakePoint(-0.12,51.50),4326)::extensions.geography)`,
      [userId, `e2e-inbox-person-${number}`, `Inbox Person ${number}`])
      await client.query(`insert into daily_interests(sender_id,recipient_id,sender_day,created_at)
        values($1,$2,current_date,now() - ($3::int * interval '1 minute'))`,
      [userId, recipientId, count - index])
    }
    await client.query('commit')
    return interestInboxFixtureIds.slice(0, count).map((_, index) => `Inbox Person ${index + 1}`)
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    await client.end()
  }
}

export async function seedFullInterestInbox(recipientId: string): Promise<string[]> {
  return seedInterestInbox(recipientId, 5)
}

export async function clearInterestInboxFixtures(recipientId: string): Promise<void> {
  assertStagingDatabaseTarget()
  const client = databaseClient()
  await client.connect()
  try {
    await client.query('begin')
    await client.query('delete from daily_interests where recipient_id=$1 or sender_id=any($2::text[])',
      [recipientId, interestInboxFixtureIds])
    await client.query('delete from users where id=any($1::text[])', [interestInboxFixtureIds])
    await client.query('update users set interest_inbox_reopens_at=null where id=$1', [recipientId])
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    await client.end()
  }
}

export async function seedEligibleProfile(
  userId: string,
  slug: string,
  displayName: string,
): Promise<void> {
  assertStagingDatabaseTarget()
  const client = databaseClient()
  await client.connect()
  try {
    await client.query('begin')
    for (const table of ['profile_photos', 'profile_activities', 'profile_interests', 'availability', 'match_preferences']) {
      await client.query(`delete from ${table} where user_id=$1`, [userId])
    }
    await client.query('delete from profiles where user_id=$1', [userId])
    await client.query(`insert into profiles(
        user_id,slug,display_name,date_of_birth,pronouns,bio,visibility,gender_identity,
        race_ethnicity,sexual_orientation,postcode_area,location_label,location
      ) values($1,$2,$3,'1995-06-15','they/them','Synthetic profile used for staging concurrency checks.',
        'active','neither','White','bisexual','EC1','Central London',
        extensions.ST_SetSRID(extensions.ST_MakePoint(-0.121,51.506),4326)::extensions.geography)`,
    [userId, slug, displayName])
    await client.query(`insert into match_preferences(
        user_id,max_distance_km,minimum_age,maximum_age,timing,public_places_only,interested_genders,
        open_to_everyone,preferred_ethnicities,no_ethnicity_preference,dating_preferences_set,
        availability_visible_before_match,interested_orientations,no_orientation_preference
      ) values($1,100,18,80,array['Weekends'],true,'{}',true,'{}',true,true,true,array['bisexual'],false)`,
    [userId])
    await client.query(`insert into profile_activities(user_id,activity_id,position)
      select $1,id,1 from activities where lower(name)=lower('Gallery walks') limit 1`, [userId])
    await client.query(`update users set onboarding_completed_at=now(),account_status='active',
      interest_inbox_reopens_at=null,paused_at=null,paused_until=null where id=$1`, [userId])
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    await client.end()
  }
}

export async function seedDailyInterestLimit(senderId: string): Promise<void> {
  assertStagingDatabaseTarget()
  const client = databaseClient()
  await client.connect()
  try {
    await client.query('begin')
    await client.query('delete from daily_interests where sender_id=$1', [senderId])
    await client.query('delete from users where id=any($1::text[])', [dailyLimitFixtureIds])
    for (const [index, userId] of dailyLimitFixtureIds.entries()) {
      const number = index + 1
      await client.query(`insert into users(
          id,email,first_name,last_name,role,account_status,timezone,account_type,onboarding_completed_at
        ) values($1,$2,$3,'Fixture','member','active','Europe/London','personal',now())`,
      [userId, `daily-limit-${number}@e2e.invalid`, `Daily ${number}`])
      await client.query(`insert into profiles(
          user_id,slug,display_name,date_of_birth,pronouns,bio,visibility,gender_identity,
          race_ethnicity,sexual_orientation,postcode_area,location_label,location
        ) values($1,$2,$3,'1993-06-15','they/them','Synthetic daily-interest fixture.',
          'active','neither','White','bisexual','EC1','Central London',
          extensions.ST_SetSRID(extensions.ST_MakePoint(-0.12,51.50),4326)::extensions.geography)`,
      [userId, `e2e-daily-limit-${number}`, `Daily Limit Person ${number}`])
      await client.query(`insert into daily_interests(sender_id,recipient_id,sender_day,created_at)
        values($1,$2,(now() at time zone 'Europe/London')::date,now() - ($3::int * interval '1 minute'))`,
      [senderId, userId, dailyLimitFixtureIds.length - index])
    }
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    await client.end()
  }
}

export async function moveDailyInterestsToPreviousDay(senderId: string): Promise<void> {
  assertStagingDatabaseTarget()
  const client = databaseClient()
  await client.connect()
  try {
    await client.query(`update daily_interests set sender_day=sender_day-1
      where sender_id=$1 and recipient_id=any($2::text[])`, [senderId, dailyLimitFixtureIds])
  } finally {
    await client.end()
  }
}

export async function clearDailyInterestLimitFixtures(senderId: string): Promise<void> {
  assertStagingDatabaseTarget()
  const client = databaseClient()
  await client.connect()
  try {
    await client.query('begin')
    await client.query('delete from daily_interests where sender_id=$1 or recipient_id=any($2::text[])',
      [senderId, dailyLimitFixtureIds])
    await client.query('delete from users where id=any($1::text[])', [dailyLimitFixtureIds])
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    await client.end()
  }
}

export type AuthorizationFixtures = {
  matchId: string
  confirmedProposalId: string
  pendingProposalId: string
  pendingTimeId: string
  notificationId: string
}

export async function seedAuthorizationFixtures(userA: string, userB: string): Promise<AuthorizationFixtures> {
  assertStagingDatabaseTarget()
  const client = databaseClient()
  await client.connect()
  try {
    await client.query('begin')
    const [userOne, userTwo] = [userA, userB].sort()
    const match = await client.query(`insert into matches(user_one_id,user_two_id,status)
      values($1,$2,'active') on conflict(user_one_id,user_two_id) do update set
      status='active',matched_at=now(),ended_by=null,ended_reason=null,ended_at=null
      returning id`, [userOne, userTwo])
    await client.query('delete from date_proposals where match_id=$1', [match.rows[0].id])
    const confirmedProposal = await client.query(`insert into date_proposals(
        match_id,inviter_id,invitee_id,activity_label,invite_note,venue,venue_address,
        venue_postcode,venue_details,status,public_venue_confirmed_at
      ) values($1,$2,$3,'Gallery visit','Authorization fixture','Tate Modern',
        'Bankside, London','SE1 9TG','At the main entrance','accepted',now()) returning id`,
    [match.rows[0].id, userA, userB])
    const confirmedTime = await client.query(`insert into proposal_times(proposal_id,proposed_at,position)
      values($1,now()+interval '7 days',1) returning id`, [confirmedProposal.rows[0].id])
    await client.query(`update date_proposals set selected_time_id=$2,confirmed_at=now()
      where id=$1`, [confirmedProposal.rows[0].id, confirmedTime.rows[0].id])
    const pendingProposal = await client.query(`insert into date_proposals(
        match_id,inviter_id,invitee_id,activity_label,invite_note,venue,venue_address,
        venue_postcode,venue_details,status,public_venue_confirmed_at
      ) values($1,$2,$3,'Coffee walk','Pending authorization fixture','Barbican Centre',
        'Silk Street, London','EC2Y 8DS','By the main box office','pending',now()) returning id`,
    [match.rows[0].id, userA, userB])
    const pendingTime = await client.query(`insert into proposal_times(proposal_id,proposed_at,position)
      values($1,now()+interval '8 days',1) returning id`, [pendingProposal.rows[0].id])
    const notification = await client.query(`insert into notifications(
      recipient_id,actor_id,match_id,proposal_id,kind
    ) values($1,$2,$3,$4,'date_confirmed') returning id`,
    [userB, userA, match.rows[0].id, confirmedProposal.rows[0].id])
    await client.query(`insert into profile_contact_details(
      user_id,phone_number,contact_email,social_handle,share_with_matches
    ) values($1,'+44 7700 900321','alice.private@example.com','@private_alice',true)
      on conflict(user_id) do update set phone_number=excluded.phone_number,
        contact_email=excluded.contact_email,social_handle=excluded.social_handle,
        share_with_matches=true`, [userA])
    await client.query('commit')
    return {
      matchId: match.rows[0].id,
      confirmedProposalId: confirmedProposal.rows[0].id,
      pendingProposalId: pendingProposal.rows[0].id,
      pendingTimeId: pendingTime.rows[0].id,
      notificationId: notification.rows[0].id,
    }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    await client.end()
  }
}

export async function authorizationFixtureState(fixtures: AuthorizationFixtures): Promise<{
  matchStatus: string
  confirmedProposalStatus: string
  pendingProposalStatus: string
  notificationRead: boolean
}> {
  assertStagingDatabaseTarget()
  const client = databaseClient()
  await client.connect()
  try {
    const { rows } = await client.query(`select
      (select status from matches where id=$1) as "matchStatus",
      (select status from date_proposals where id=$2) as "confirmedProposalStatus",
      (select status from date_proposals where id=$3) as "pendingProposalStatus",
      (select read_at is not null from notifications where id=$4) as "notificationRead"`,
    [fixtures.matchId, fixtures.confirmedProposalId, fixtures.pendingProposalId, fixtures.notificationId])
    return rows[0]
  } finally {
    await client.end()
  }
}

export type MatchLimitFixture = {
  matchId: string
  userId: string
  name: string
  slug: string
}

export type MatchLimitFixtures = {
  active: MatchLimitFixture[]
  queued: MatchLimitFixture[]
}

export async function seedMatchLimitFixtures(
  ownerId: string,
  activeCount: number,
  queuedCount: number,
): Promise<MatchLimitFixtures> {
  if (!Number.isInteger(activeCount) || activeCount < 0 || activeCount > activeMatchFixtureIds.length) {
    throw new Error('Active match fixture count must be between 0 and 3')
  }
  if (!Number.isInteger(queuedCount) || queuedCount < 0 || queuedCount > queuedMatchFixtureIds.length) {
    throw new Error('Queued match fixture count must be between 0 and 2')
  }
  assertStagingDatabaseTarget()
  const client = databaseClient()
  await client.connect()
  try {
    await client.query('begin')
    await client.query(`select pg_advisory_xact_lock(hashtext('e2e-match-limit-fixtures'))`)
    await client.query(`delete from notifications where recipient_id=$1 or actor_id=$1
      or recipient_id=any($2::text[]) or actor_id=any($2::text[])`, [ownerId, matchLimitFixtureIds])
    await client.query(`delete from matches where user_one_id=$1 or user_two_id=$1
      or user_one_id=any($2::text[]) or user_two_id=any($2::text[])`, [ownerId, matchLimitFixtureIds])
    await client.query('delete from users where id=any($1::text[])', [matchLimitFixtureIds])
    await client.query(`insert into entitlements(user_id,plan,subscription_status,cancel_at_period_end)
      values($1,'free','no_subscription',false) on conflict(user_id) do update set
      plan='free',subscription_status='no_subscription',current_period_start=null,current_period_end=null,
      cancel_at_period_end=false,canceled_at=null`, [ownerId])

    for (const [index, userId] of matchLimitFixtureIds.entries()) {
      const isActiveFixture = index < activeMatchFixtureIds.length
      const number = isActiveFixture ? index + 1 : index - activeMatchFixtureIds.length + 1
      const type = isActiveFixture ? 'Active' : 'Waiting'
      await client.query(`insert into users(
          id,email,first_name,last_name,role,account_status,timezone,account_type,onboarding_completed_at
        ) values($1,$2,$3,'Fixture','member','active','Europe/London','personal',now())`,
      [userId, `match-limit-${index + 1}@e2e.invalid`, `${type} ${number}`])
      await client.query(`insert into entitlements(user_id,plan,subscription_status,cancel_at_period_end)
        values($1,'free','no_subscription',false)`, [userId])
      await client.query(`insert into profiles(
          user_id,slug,display_name,date_of_birth,pronouns,bio,visibility,gender_identity,
          race_ethnicity,sexual_orientation,postcode_area,location_label,location
        ) values($1,$2,$3,'1993-06-15','they/them','Synthetic match-limit fixture.',
          'active','neither','White','bisexual','EC1','Central London',
          extensions.ST_SetSRID(extensions.ST_MakePoint(-0.12,51.50),4326)::extensions.geography)`,
      [userId, `e2e-${type.toLowerCase()}-match-${number}`, `${type} Match ${number}`])
    }

    const active: MatchLimitFixture[] = []
    for (const [index, userId] of activeMatchFixtureIds.slice(0, activeCount).entries()) {
      const [userOne, userTwo] = [ownerId, userId].sort()
      const result = await client.query(`insert into matches(user_one_id,user_two_id,status,matched_at)
        values($1,$2,'active',now()-($3::int * interval '1 minute')) returning id`,
      [userOne, userTwo, activeCount - index])
      active.push({ matchId: result.rows[0].id, userId,
        name: `Active Match ${index + 1}`, slug: `e2e-active-match-${index + 1}` })
    }
    const queued: MatchLimitFixture[] = []
    for (const [index, userId] of queuedMatchFixtureIds.slice(0, queuedCount).entries()) {
      const [userOne, userTwo] = [ownerId, userId].sort()
      const result = await client.query(`insert into matches(user_one_id,user_two_id,status,matched_at)
        values($1,$2,'queued',now()-($3::int * interval '1 minute')) returning id`,
      [userOne, userTwo, queuedCount - index])
      queued.push({ matchId: result.rows[0].id, userId,
        name: `Waiting Match ${index + 1}`, slug: `e2e-waiting-match-${index + 1}` })
    }
    await client.query('commit')
    return { active, queued }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    await client.end()
  }
}

export async function addQueuedMatchLimitFixture(ownerId: string, index = 0): Promise<MatchLimitFixture> {
  if (!Number.isInteger(index) || index < 0 || index >= queuedMatchFixtureIds.length) {
    throw new Error('Queued match fixture index must be 0 or 1')
  }
  assertStagingDatabaseTarget()
  const client = databaseClient()
  await client.connect()
  try {
    const userId = queuedMatchFixtureIds[index]
    const [userOne, userTwo] = [ownerId, userId].sort()
    const { rows } = await client.query(`insert into matches(user_one_id,user_two_id,status,matched_at)
      values($1,$2,'queued',now()) on conflict(user_one_id,user_two_id) do update set
      status='queued',matched_at=now(),ended_by=null,ended_reason=null,ended_at=null
      returning id`, [userOne, userTwo])
    return { matchId: rows[0].id, userId,
      name: `Waiting Match ${index + 1}`, slug: `e2e-waiting-match-${index + 1}` }
  } finally {
    await client.end()
  }
}

export async function matchLimitState(ownerId: string, matchIds: string[]): Promise<{
  activeCount: number
  statuses: Record<string, string>
}> {
  assertStagingDatabaseTarget()
  const client = databaseClient()
  await client.connect()
  try {
    const active = await client.query(`select count(*)::int as count from matches where status='active'
      and (user_one_id=$1 or user_two_id=$1)`, [ownerId])
    const matches = await client.query(`select id,status from matches where id=any($1::uuid[])`, [matchIds])
    return {
      activeCount: active.rows[0]?.count || 0,
      statuses: Object.fromEntries(matches.rows.map(row => [row.id, row.status])),
    }
  } finally {
    await client.end()
  }
}

export async function clearMatchLimitFixtures(ownerId: string): Promise<void> {
  assertStagingDatabaseTarget()
  const client = databaseClient()
  await client.connect()
  try {
    await client.query('begin')
    await client.query(`delete from notifications where recipient_id=$1 or actor_id=$1
      or recipient_id=any($2::text[]) or actor_id=any($2::text[])`, [ownerId, matchLimitFixtureIds])
    await client.query(`delete from matches where user_one_id=$1 or user_two_id=$1
      or user_one_id=any($2::text[]) or user_two_id=any($2::text[])`, [ownerId, matchLimitFixtureIds])
    await client.query('delete from users where id=any($1::text[])', [matchLimitFixtureIds])
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    await client.end()
  }
}
