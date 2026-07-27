import pg from 'pg'
import { env } from './env.js'

export async function resetRelationshipPair(userA: string, userB: string): Promise<void> {
  if (process.env.E2E_ALLOW_DATABASE_RESET !== 'true') {
    throw new Error('Set E2E_ALLOW_DATABASE_RESET=true to confirm this is an isolated E2E database')
  }
  const client = new pg.Client({
    connectionString: env('E2E_DATABASE_URL'),
    ssl: process.env.E2E_DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  })
  await client.connect()
  try {
    await client.query('begin')
    await client.query(`delete from notifications where
      (actor_id=$1 and recipient_id=$2) or (actor_id=$2 and recipient_id=$1)`, [userA, userB])
    await client.query(`delete from daily_interests where
      (sender_id=$1 and recipient_id=$2) or (sender_id=$2 and recipient_id=$1)`, [userA, userB])
    await client.query(`delete from blocks where
      (blocker_id=$1 and blocked_id=$2) or (blocker_id=$2 and blocked_id=$1)`, [userA, userB])
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
