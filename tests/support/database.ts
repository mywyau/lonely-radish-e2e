import pg from 'pg'
import { assertStagingDatabaseTarget, env } from './env.js'

const interestInboxFixtureIds = Array.from({ length: 5 }, (_, index) =>
  `e2e-interest-inbox-sender-${index + 1}`)

function databaseClient(): pg.Client {
  return new pg.Client({
    connectionString: env('E2E_DATABASE_URL'),
    ssl: process.env.E2E_DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  })
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

export async function seedFullInterestInbox(recipientId: string): Promise<string[]> {
  assertStagingDatabaseTarget()
  const client = databaseClient()
  await client.connect()
  try {
    await client.query('begin')
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`e2e-interest-inbox:${recipientId}`])
    await client.query('delete from daily_interests where recipient_id=$1', [recipientId])
    await client.query('delete from users where id=any($1::text[])', [interestInboxFixtureIds])
    await client.query('update users set interest_inbox_reopens_at=null where id=$1', [recipientId])

    for (const [index, userId] of interestInboxFixtureIds.entries()) {
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
      [userId, recipientId, interestInboxFixtureIds.length - index])
    }
    await client.query('commit')
    return interestInboxFixtureIds.map((_, index) => `Inbox Person ${index + 1}`)
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    await client.end()
  }
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
