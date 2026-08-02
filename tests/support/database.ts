import pg from 'pg'
import { assertStagingDatabaseTarget, env } from './env.js'

export async function resetRelationshipPair(userA: string, userB: string): Promise<void> {
  assertStagingDatabaseTarget()
  const client = new pg.Client({
    connectionString: env('E2E_DATABASE_URL'),
    ssl: process.env.E2E_DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  })
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
  const client = new pg.Client({
    connectionString: env('E2E_DATABASE_URL'),
    ssl: process.env.E2E_DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  })
  await client.connect()
  try {
    await client.query('update users set interest_inbox_reopens_at=null where id=$1', [userId])
  } finally {
    await client.end()
  }
}

export async function resetNewMemberOnboarding(userId: string): Promise<void> {
  assertStagingDatabaseTarget()
  const client = new pg.Client({
    connectionString: env('E2E_DATABASE_URL'),
    ssl: process.env.E2E_DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  })
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
  const client = new pg.Client({
    connectionString: env('E2E_DATABASE_URL'),
    ssl: process.env.E2E_DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  })
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
  const client = new pg.Client({
    connectionString: env('E2E_DATABASE_URL'),
    ssl: process.env.E2E_DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  })
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
