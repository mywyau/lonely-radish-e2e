import { expect, test } from '@playwright/test'
import {
  authorizationFixtureState,
  clearContactDetails,
  resetNewMemberOnboarding,
  resetRelationshipPair,
  seedAuthorizationFixtures,
  seedEligibleProfile,
} from '../support/database.js'
import { env, hasLifecycleEnvironment, optionalStatePath } from '../support/env.js'
import { openMember } from '../support/member.js'

const newMemberState = optionalStatePath('E2E_NEW_MEMBER_STATE')

test('one member cannot mutate another pair’s private records', async ({ browser }) => {
  test.skip(!hasLifecycleEnvironment() || !newMemberState,
    'Run npm run prepare:staging to create all three lifecycle accounts')
  test.setTimeout(90_000)
  const memberA = { id: env('E2E_MEMBER_A_ID'), slug: env('E2E_MEMBER_A_SLUG') }
  const memberB = { id: env('E2E_MEMBER_B_ID') }
  const outsider = { id: env('E2E_NEW_MEMBER_ID') }
  await resetRelationshipPair(memberA.id, memberB.id)
  await resetRelationshipPair(memberA.id, outsider.id)
  await resetRelationshipPair(memberB.id, outsider.id)
  await resetNewMemberOnboarding(outsider.id)
  await seedEligibleProfile(outsider.id, env('E2E_NEW_MEMBER_SLUG'), env('E2E_NEW_MEMBER_NAME'))
  await clearContactDetails(memberA.id)
  const fixtures = await seedAuthorizationFixtures(memberA.id, memberB.id)
  const a = await openMember(browser, 'E2E_MEMBER_A_STATE')
  const third = await openMember(browser, 'E2E_NEW_MEMBER_STATE')

  try {
    await test.step('unmatched contact details remain private through the profile API', async () => {
      await third.page.goto(`/profiles/${memberA.slug}`)
      const response = await third.page.request.get(`/api/profiles/${memberA.slug}`)
      expect(response.ok()).toBe(true)
      expect((await response.json()).contactDetails).toBeNull()
      await expect(third.page.getByRole('button', { name: 'Show shared contact details' })).toHaveCount(0)
    })

    await test.step('an injected user id cannot redirect a profile update', async () => {
      const response = await third.page.request.put('/api/profile/contact', {
        data: {
          userId: memberA.id,
          phoneNumber: '+44 7700 900999',
          contactEmail: 'outsider@example.com',
          socialHandle: '@outsider',
          shareWithMatches: true,
        },
      })
      expect(response.ok()).toBe(true)
      const ownerContact = await a.page.request.get('/api/profile/contact')
      expect(await ownerContact.json()).toMatchObject({
        phoneNumber: '+44 7700 900321',
        contactEmail: 'alice.private@example.com',
        socialHandle: '@private_alice',
      })
      const outsiderContact = await third.page.request.get('/api/profile/contact')
      expect(await outsiderContact.json()).toMatchObject({
        phoneNumber: '+44 7700 900999',
        contactEmail: 'outsider@example.com',
        socialHandle: '@outsider',
      })
    })

    await test.step('another member cannot read the recipient’s notification', async () => {
      const response = await third.page.request.post(`/api/notifications/${fixtures.notificationId}/read`)
      expect(response.status()).toBe(404)
    })

    await test.step('another member cannot cancel or reschedule the pair’s date', async () => {
      const cancel = await third.page.request.post(`/api/proposals/${fixtures.confirmedProposalId}/attendance`, {
        data: { action: 'cancel' },
      })
      expect(cancel.status()).toBe(409)

      const beginReschedule = await third.page.request.post(
        `/api/proposals/${fixtures.confirmedProposalId}/attendance`,
        { data: { action: 'reschedule' } },
      )
      expect(beginReschedule.status()).toBe(409)

      const reschedule = await third.page.request.put(`/api/proposals/${fixtures.pendingProposalId}`, {
        data: {
          activity: 'Unauthorized change',
          inviteNote: 'This must not be saved.',
          venue: 'National Gallery',
          venueAddress: 'Trafalgar Square, London',
          venuePostcode: 'WC2N 5DN',
          meetingPoint: 'At the main entrance',
          publicVenueConfirmed: true,
          times: [new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString()],
          fullReproposal: true,
        },
      })
      expect(reschedule.status()).toBe(404)
    })

    await test.step('another member cannot accept or decline the pending proposal', async () => {
      const accept = await third.page.request.post(`/api/proposals/${fixtures.pendingProposalId}/respond`, {
        data: { status: 'accepted', timeId: fixtures.pendingTimeId },
      })
      expect(accept.status()).toBe(409)
      const decline = await third.page.request.post(`/api/proposals/${fixtures.pendingProposalId}/respond`, {
        data: { status: 'declined' },
      })
      expect(decline.status()).toBe(409)
    })

    await test.step('another member cannot end the pair’s match', async () => {
      const response = await third.page.request.delete(`/api/matches/${fixtures.matchId}`)
      expect(response.status()).toBe(404)
      expect(await authorizationFixtureState(fixtures)).toEqual({
        matchStatus: 'active',
        confirmedProposalStatus: 'accepted',
        pendingProposalStatus: 'pending',
        notificationRead: false,
      })
    })
  } finally {
    await Promise.allSettled([a.context.close(), third.context.close()])
    await clearContactDetails(memberA.id)
    await clearContactDetails(outsider.id)
    await resetRelationshipPair(memberA.id, memberB.id)
    await resetRelationshipPair(memberA.id, outsider.id)
    await resetRelationshipPair(memberB.id, outsider.id)
    await resetNewMemberOnboarding(outsider.id)
  }
})
