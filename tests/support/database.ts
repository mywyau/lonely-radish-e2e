import pg from 'pg'
import { assertStagingDatabaseTarget, env } from './env.js'

const interestInboxFixtureIds = Array.from({ length: 5 }, (_, index) =>
  `e2e-interest-inbox-sender-${index + 1}`)
const dailyLimitFixtureIds = Array.from({ length: 5 }, (_, index) =>
  `e2e-daily-limit-recipient-${index + 1}`)

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
