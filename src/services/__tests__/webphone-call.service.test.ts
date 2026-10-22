import type { WhatsAppPhoneCall } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeUser } from '@/src/__tests__/factories/user.factory'
import { createFakeWhatsAppConversationWithPreview } from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { createFakeWhatsAppPhoneCall } from '@/src/__tests__/factories/whatsapp-phone-call.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/env/server', () => ({
  BETTER_AUTH_URL: 'https://steel.test',
  PABX_CALLBACK_URL: undefined,
}))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/user.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/repositories/whatsapp-phone-call.repository')
vi.mock('@/src/repositories/whatsapp-settings.repository')
vi.mock('../phone-call-link.service')
vi.mock('@/src/lib/whatsapp/realtime', () => ({
  publishWhatsAppEvent: vi.fn(async () => undefined),
}))

import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { UserRepository } from '@/src/repositories/user.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppPhoneCallRepository } from '@/src/repositories/whatsapp-phone-call.repository'
import { WhatsAppSettingsRepository } from '@/src/repositories/whatsapp-settings.repository'
import { PhoneCallLinkService } from '../phone-call-link.service'
import { WebphoneCallService } from '../webphone-call.service'

const membershipRepo = vi.mocked(MembershipRepository)
const userRepo = vi.mocked(UserRepository)
const conversationRepo = vi.mocked(WhatsAppConversationRepository)
const callRepo = vi.mocked(WhatsAppPhoneCallRepository)
const settingsRepo = vi.mocked(WhatsAppSettingsRepository)
const linkService = vi.mocked(PhoneCallLinkService)
const publish = vi.mocked(publishWhatsAppEvent)

const NOW = new Date('2026-10-22T15:00:00Z')

function stored(overrides: Partial<WhatsAppPhoneCall> = {}) {
  return createFakeWhatsAppPhoneCall({
    id: 'call1',
    workspaceId: 'ws1',
    userId: 'u1',
    conversationId: 'conv1',
    source: 'WEBPHONE',
    ...overrides,
  })
}

/** The repository echoes the written fields back over the stored call. */
function echo(base: WhatsAppPhoneCall) {
  callRepo.update.mockImplementation(async (_id, data) =>
    ok({ ...base, ...(data as Partial<WhatsAppPhoneCall>) }),
  )
  callRepo.create.mockImplementation(async (data) =>
    ok({
      ...base,
      ...(data as Partial<WhatsAppPhoneCall>),
      id: 'new1',
    }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  membershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'MEMBER' })),
  )
  userRepo.findById.mockResolvedValue(
    ok(
      createFakeUser({
        pabxExtension: '200',
        pabxDeviceId: '123',
        pabxWebphoneEnabled: true,
      }),
    ),
  )
  settingsRepo.findByWorkspace.mockResolvedValue(ok(null))
  callRepo.findByPabxUniqueId.mockResolvedValue(ok(null))
  callRepo.listLiveByExtension.mockResolvedValue(ok([]))
  linkService.findConversationId.mockResolvedValue('conv-by-number')
  linkService.resolve.mockResolvedValue({
    sdTicketId: 't1',
    crmPersonId: 'p1',
    crmOpportunityId: 'o1',
  })
  echo(stored())
})

describe('WebphoneCallService.begin()', () => {
  it('records an outbound call linked to the conversation by number', async () => {
    const result = expectOk(
      await WebphoneCallService.begin(
        'u1',
        'ws1',
        { direction: 'out', number: '011999998888', name: 'Maria' },
        NOW,
      ),
    )

    expect(linkService.findConversationId).toHaveBeenCalledWith(
      'ws1',
      '011999998888',
    )
    expect(callRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws1',
        conversationId: 'conv-by-number',
        userId: 'u1',
        deviceId: '123',
        extension: '200',
        destination: '011999998888',
        direction: 'OUTBOUND',
        source: 'WEBPHONE',
        status: 'DIALING',
        remoteName: 'Maria',
        recordingRequested: false,
      }),
    )
    expect(result.adopted).toBe(false)
    expect(result.record).toBe(false)
    expect(result.callbackToken).toEqual(expect.any(String))
    expect(result.callbackUrl).toBe('https://steel.test/api/pabx/calls/webhook')
    expect(publish).toHaveBeenCalledWith('ws1', {
      type: 'phone-call.updated',
      call: expect.objectContaining({ id: 'new1' }),
    })
  })

  it('asks for recording when the workspace records calls', async () => {
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok({
        callRecordingEnabled: true,
        callRecordingNotice: 'Esta ligação pode ser gravada.',
      } as never),
    )
    const result = expectOk(
      await WebphoneCallService.begin('u1', 'ws1', {
        direction: 'out',
        number: '11999998888',
      }),
    )
    expect(result.record).toBe(true)
    expect(result.call.recordingNotice).toBe('Esta ligação pode ser gravada.')
    expect(callRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ recordingRequested: true }),
    )
  })

  it('records an inbound call without a token and never asks to record it', async () => {
    settingsRepo.findByWorkspace.mockResolvedValue(
      ok({ callRecordingEnabled: true } as never),
    )
    linkService.findConversationId.mockResolvedValue(null)
    const result = expectOk(
      await WebphoneCallService.begin('u1', 'ws1', {
        direction: 'in',
        number: 'anonymous',
        pabxUniqueId: '1729.1',
      }),
    )
    expect(result.callbackToken).toBeNull()
    expect(result.record).toBe(false)
    expect(callRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: null,
        direction: 'INBOUND',
        status: 'QUEUED',
        destination: 'anonymous',
        pabxUniqueId: '1729.1',
        recordingRequested: false,
      }),
    )
  })

  it('uses the conversation the UI names, when the user can see it', async () => {
    conversationRepo.findById.mockResolvedValue(
      ok(
        createFakeWhatsAppConversationWithPreview({
          id: 'conv-ui',
        }),
      ),
    )
    expectOk(
      await WebphoneCallService.begin('u1', 'ws1', {
        direction: 'out',
        number: '11999998888',
        conversationId: 'conv-ui',
      }),
    )
    expect(linkService.findConversationId).not.toHaveBeenCalled()
    expect(callRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-ui' }),
    )

    conversationRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WebphoneCallService.begin('u1', 'ws1', {
        direction: 'out',
        number: '11999998888',
        conversationId: 'nope',
      }),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    )
  })

  it('reuses the row with the same PABX unique id and keeps no second one', async () => {
    const existing = stored({ pabxUniqueId: '1729.1' })
    callRepo.findByPabxUniqueId.mockResolvedValue(ok(existing))
    const result = expectOk(
      await WebphoneCallService.begin('u1', 'ws1', {
        direction: 'in',
        number: '11999998888',
        pabxUniqueId: '1729.1',
      }),
    )
    expect(result.adopted).toBe(true)
    expect(result.callbackToken).toBeNull()
    expect(result.record).toBe(false)
    expect(callRepo.create).not.toHaveBeenCalled()
    expect(callRepo.update).not.toHaveBeenCalled()
  })

  it('adopts the click-to-call ring the browser extension just received', async () => {
    const ring = stored({
      id: 'ring1',
      source: 'CLICK_TO_CALL',
      status: 'QUEUED',
      destination: '11999998888',
      pabxUniqueId: null,
    })
    callRepo.listLiveByExtension.mockResolvedValue(
      ok([
        stored({ id: 'web', source: 'WEBPHONE', destination: '11999998888' }),
        stored({
          id: 'elsewhere',
          source: 'CLICK_TO_CALL',
          destination: '11888887777',
        }),
        ring,
      ]),
    )
    echo(ring)
    const result = expectOk(
      await WebphoneCallService.begin(
        'u1',
        'ws1',
        {
          direction: 'in',
          number: '5511999998888',
          pabxUniqueId: '1729.9',
        },
        NOW,
      ),
    )
    expect(result.adopted).toBe(true)
    expect(callRepo.create).not.toHaveBeenCalled()
    expect(callRepo.listLiveByExtension).toHaveBeenCalledWith(
      'ws1',
      '200',
      new Date(NOW.getTime() - 5 * 60 * 1000),
    )
    expect(callRepo.update).toHaveBeenCalledWith('ring1', {
      pabxUniqueId: '1729.9',
    })
    expect(result.call.id).toBe('ring1')
  })

  it('adopts without touching the row when it already has an id or none is sent', async () => {
    callRepo.listLiveByExtension.mockResolvedValue(
      ok([
        stored({
          id: 'ring1',
          source: 'CLICK_TO_CALL',
          destination: '200',
          pabxUniqueId: 'x',
        }),
      ]),
    )
    const result = expectOk(
      await WebphoneCallService.begin('u1', 'ws1', {
        direction: 'in',
        number: '200',
      }),
    )
    expect(result.adopted).toBe(true)
    expect(callRepo.update).not.toHaveBeenCalled()
  })

  it('never looks for a ring when the browser is the one dialing', async () => {
    expectOk(
      await WebphoneCallService.begin('u1', 'ws1', {
        direction: 'out',
        number: '11999998888',
      }),
    )
    expect(callRepo.listLiveByExtension).not.toHaveBeenCalled()
  })

  it('refuses a non-member, a missing extension and a phone not released', async () => {
    membershipRepo.findByUserAndWorkspace.mockResolvedValueOnce(ok(null))
    expectErr(
      await WebphoneCallService.begin('u1', 'ws1', {
        direction: 'out',
        number: '11999998888',
      }),
    )

    userRepo.findById.mockResolvedValueOnce(
      ok(createFakeUser({ pabxExtension: null, pabxDeviceId: '1' })),
    )
    expectErr(
      await WebphoneCallService.begin('u1', 'ws1', {
        direction: 'out',
        number: '11999998888',
      }),
      'PABX_EXTENSION_REQUIRED',
    )

    userRepo.findById.mockResolvedValueOnce(
      ok(
        createFakeUser({
          pabxExtension: '200',
          pabxDeviceId: '1',
          pabxWebphoneEnabled: false,
        }),
      ),
    )
    expectErr(
      await WebphoneCallService.begin('u1', 'ws1', {
        direction: 'out',
        number: '11999998888',
      }),
      'FORBIDDEN',
    )
    expect(callRepo.create).not.toHaveBeenCalled()
  })

  it('propagates repository failures', async () => {
    const input = { direction: 'in', number: '11999998888' } as const
    const DB = err(databaseError('db'))

    userRepo.findById.mockResolvedValueOnce(DB)
    expectErr(await WebphoneCallService.begin('u1', 'ws1', input))

    callRepo.findByPabxUniqueId.mockResolvedValueOnce(DB)
    expectErr(
      await WebphoneCallService.begin('u1', 'ws1', {
        ...input,
        pabxUniqueId: 'x',
      }),
    )

    callRepo.listLiveByExtension.mockResolvedValueOnce(DB)
    expectErr(await WebphoneCallService.begin('u1', 'ws1', input))

    callRepo.listLiveByExtension.mockResolvedValueOnce(
      ok([
        stored({
          source: 'CLICK_TO_CALL',
          destination: '11999998888',
          pabxUniqueId: null,
        }),
      ]),
    )
    callRepo.update.mockResolvedValueOnce(DB)
    expectErr(
      await WebphoneCallService.begin('u1', 'ws1', {
        ...input,
        pabxUniqueId: 'x',
      }),
    )

    settingsRepo.findByWorkspace.mockResolvedValueOnce(DB)
    expectErr(await WebphoneCallService.begin('u1', 'ws1', input))

    callRepo.create.mockResolvedValueOnce(DB)
    expectErr(await WebphoneCallService.begin('u1', 'ws1', input))
  })
})

describe('WebphoneCallService.report()', () => {
  it('marks the call in progress when answered, once', async () => {
    callRepo.findById.mockResolvedValue(ok(stored({ status: 'DIALING' })))
    const dto = expectOk(
      await WebphoneCallService.report(
        'u1',
        'ws1',
        'call1',
        { event: 'answered' },
        NOW,
      ),
    )
    expect(dto.status).toBe('IN_PROGRESS')
    expect(callRepo.update).toHaveBeenCalledWith('call1', {
      status: 'IN_PROGRESS',
      answeredAt: NOW,
    })
    expect(publish).toHaveBeenCalledTimes(1)

    callRepo.update.mockClear()
    callRepo.findById.mockResolvedValue(ok(stored({ status: 'IN_PROGRESS' })))
    expectOk(
      await WebphoneCallService.report('u1', 'ws1', 'call1', {
        event: 'answered',
      }),
    )
    expect(callRepo.update).not.toHaveBeenCalled()
  })

  it('closes an answered call with the duration measured here and the record links', async () => {
    const answeredAt = new Date(NOW.getTime() - 95_000)
    callRepo.findById.mockResolvedValue(
      ok(stored({ status: 'IN_PROGRESS', answeredAt })),
    )
    const dto = expectOk(
      await WebphoneCallService.report(
        'u1',
        'ws1',
        'call1',
        { event: 'ended', outcome: 'completed' },
        NOW,
      ),
    )
    expect(dto).toMatchObject({ status: 'COMPLETED', durationSeconds: 95 })
    expect(callRepo.update).toHaveBeenCalledWith('call1', {
      status: 'COMPLETED',
      endedAt: NOW,
      answeredAt,
      durationSeconds: 95,
      sdTicketId: 't1',
      crmPersonId: 'p1',
      crmOpportunityId: 'o1',
    })
  })

  it('counts a completed outcome as answered even if the answer was lost', async () => {
    callRepo.findById.mockResolvedValue(ok(stored({ status: 'DIALING' })))
    const dto = expectOk(
      await WebphoneCallService.report(
        'u1',
        'ws1',
        'call1',
        { event: 'ended', outcome: 'completed' },
        NOW,
      ),
    )
    expect(dto).toMatchObject({ status: 'COMPLETED', durationSeconds: 0 })
    expect(dto.answeredAt).toBe(NOW.toISOString())
  })

  it.each([
    ['busy', 'BUSY'],
    ['missed', 'NO_ANSWER'],
    ['declined', 'CANCELED'],
    ['canceled', 'CANCELED'],
    ['failed', 'FAILED'],
    [undefined, 'FAILED'],
  ] as const)(
    'maps the unanswered outcome %s to %s',
    async (outcome, status) => {
      callRepo.findById.mockResolvedValue(ok(stored({ status: 'DIALING' })))
      const dto = expectOk(
        await WebphoneCallService.report(
          'u1',
          'ws1',
          'call1',
          { event: 'ended', outcome },
          NOW,
        ),
      )
      expect(dto).toMatchObject({
        status,
        durationSeconds: null,
        answeredAt: null,
      })
    },
  )

  it('keeps the first final report and only fills the missing links', async () => {
    const closed = stored({ status: 'COMPLETED', durationSeconds: 40 })
    callRepo.findById.mockResolvedValue(ok(closed))
    echo(closed)
    const dto = expectOk(
      await WebphoneCallService.report('u1', 'ws1', 'call1', {
        event: 'ended',
        outcome: 'failed',
      }),
    )
    expect(dto.status).toBe('COMPLETED')
    expect(callRepo.update).toHaveBeenCalledWith('call1', {
      sdTicketId: 't1',
      crmPersonId: 'p1',
      crmOpportunityId: 'o1',
    })
  })

  it('leaves a closed call alone when it is linked already or nothing matches', async () => {
    callRepo.findById.mockResolvedValue(
      ok(stored({ status: 'COMPLETED', sdTicketId: 't9' })),
    )
    expectOk(
      await WebphoneCallService.report('u1', 'ws1', 'call1', {
        event: 'ended',
      }),
    )
    expect(linkService.resolve).not.toHaveBeenCalled()

    callRepo.findById.mockResolvedValue(ok(stored({ status: 'COMPLETED' })))
    linkService.resolve.mockResolvedValue({
      sdTicketId: null,
      crmPersonId: null,
      crmOpportunityId: null,
    })
    expectOk(
      await WebphoneCallService.report('u1', 'ws1', 'call1', {
        event: 'ended',
      }),
    )
    expect(callRepo.update).not.toHaveBeenCalled()

    // A person without ticket or opportunity is still worth linking.
    linkService.resolve.mockResolvedValue({
      sdTicketId: null,
      crmPersonId: 'p1',
      crmOpportunityId: null,
    })
    callRepo.update.mockResolvedValueOnce(err(databaseError('db')))
    expectErr(
      await WebphoneCallService.report('u1', 'ws1', 'call1', {
        event: 'ended',
      }),
    )
  })

  it('hides a call that is not the actor, not in the workspace or missing', async () => {
    callRepo.findById.mockResolvedValue(ok(stored({ userId: 'someone-else' })))
    expectErr(
      await WebphoneCallService.report('u1', 'ws1', 'call1', {
        event: 'answered',
      }),
      'PHONE_CALL_NOT_FOUND',
    )

    callRepo.findById.mockResolvedValue(ok(stored({ workspaceId: 'ws2' })))
    expectErr(
      await WebphoneCallService.report('u1', 'ws1', 'call1', {
        event: 'answered',
      }),
      'PHONE_CALL_NOT_FOUND',
    )

    callRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WebphoneCallService.report('u1', 'ws1', 'call1', {
        event: 'answered',
      }),
      'PHONE_CALL_NOT_FOUND',
    )
    expect(callRepo.update).not.toHaveBeenCalled()
  })

  it('refuses a non-member and propagates repository failures', async () => {
    membershipRepo.findByUserAndWorkspace.mockResolvedValueOnce(ok(null))
    expectErr(
      await WebphoneCallService.report('u1', 'ws1', 'call1', {
        event: 'answered',
      }),
    )

    callRepo.findById.mockResolvedValueOnce(err(databaseError('db')))
    expectErr(
      await WebphoneCallService.report('u1', 'ws1', 'call1', {
        event: 'answered',
      }),
    )

    callRepo.findById.mockResolvedValue(ok(stored({ status: 'DIALING' })))
    callRepo.update.mockResolvedValueOnce(err(databaseError('db')))
    expectErr(
      await WebphoneCallService.report('u1', 'ws1', 'call1', {
        event: 'answered',
      }),
    )
    callRepo.update.mockResolvedValueOnce(err(databaseError('db')))
    expectErr(
      await WebphoneCallService.report('u1', 'ws1', 'call1', {
        event: 'ended',
      }),
    )
  })
})
