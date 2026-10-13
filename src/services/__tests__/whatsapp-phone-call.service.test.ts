import { createHash } from 'node:crypto'
import type { WhatsAppPhoneCall } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeUser } from '@/src/__tests__/factories/user.factory'
import { createFakeWhatsAppConversationWithPreview } from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { createFakeWhatsAppPhoneCall } from '@/src/__tests__/factories/whatsapp-phone-call.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, pabxCallFailed } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/env/server', () => ({
  BETTER_AUTH_URL: 'https://steel.test',
  PABX_CALLBACK_URL: undefined,
}))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/user.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/repositories/whatsapp-phone-call.repository')
vi.mock('@/src/lib/pabx/click-to-call', () => ({ placePabxCall: vi.fn() }))
vi.mock('@/src/lib/whatsapp/realtime', () => ({
  publishWhatsAppEvent: vi.fn(async () => undefined),
}))

import { placePabxCall } from '@/src/lib/pabx/click-to-call'
import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { UserRepository } from '@/src/repositories/user.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppPhoneCallRepository } from '@/src/repositories/whatsapp-phone-call.repository'
import { WhatsAppPhoneCallService } from '../whatsapp-phone-call.service'

const mockedMembershipRepo = vi.mocked(MembershipRepository)
const mockedUserRepo = vi.mocked(UserRepository)
const mockedConversationRepo = vi.mocked(WhatsAppConversationRepository)
const mockedCallRepo = vi.mocked(WhatsAppPhoneCallRepository)
const mockedPlaceCall = vi.mocked(placePabxCall)
const mockedPublish = vi.mocked(publishWhatsAppEvent)

const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345'

function conversationWithContact(waId: string) {
  const conversation = createFakeWhatsAppConversationWithPreview({
    id: 'conv1',
  })
  return { ...conversation, contact: { ...conversation.contact, waId } }
}

/** The repository echoes the patch back over the stored call. */
function echoUpdates(base: WhatsAppPhoneCall) {
  mockedCallRepo.update.mockImplementation(async (_id, data) =>
    ok({ ...base, ...(data as Partial<WhatsAppPhoneCall>) }),
  )
}

describe('WhatsAppPhoneCallService.start()', () => {
  const created = createFakeWhatsAppPhoneCall({
    id: 'call1',
    workspaceId: 'ws1',
    conversationId: 'conv1',
    destination: '5511999999999',
    job: null,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership({ role: 'MEMBER' })),
    )
    mockedConversationRepo.findById.mockResolvedValue(
      ok(conversationWithContact('5511999999999')),
    )
    mockedUserRepo.findById.mockResolvedValue(
      ok(createFakeUser({ pabxExtension: '200', pabxDeviceId: '123' })),
    )
    mockedCallRepo.create.mockResolvedValue(ok(created))
    echoUpdates(created)
    mockedPlaceCall.mockResolvedValue(
      ok({ destination: '11999999999', job: 'steel_api_123_abc' }),
    )
  })

  it("queues the call on the actor's PABX and publishes it", async () => {
    const result = await WhatsAppPhoneCallService.start('u1', 'ws1', 'conv1')

    expect(expectOk(result)).toMatchObject({
      id: 'call1',
      status: 'QUEUED',
      destination: '11999999999',
    })

    const createData = mockedCallRepo.create.mock.calls[0][0]
    expect(createData).toMatchObject({
      workspaceId: 'ws1',
      conversationId: 'conv1',
      userId: 'u1',
      deviceId: '123',
      extension: '200',
    })
    const placed = mockedPlaceCall.mock.calls[0][0]
    expect(placed).toMatchObject({
      deviceId: '123',
      extension: '200',
      destination: '5511999999999',
      callbackUrl: 'https://steel.test/api/pabx/calls/webhook',
    })
    // Only the hash of the callback token is stored.
    expect(createData.callbackTokenHash).toBe(
      createHash('sha256').update(placed.callbackToken).digest('hex'),
    )
    expect(mockedCallRepo.update).toHaveBeenCalledWith('call1', {
      destination: '11999999999',
      job: 'steel_api_123_abc',
    })
    expect(mockedPublish).toHaveBeenCalledWith('ws1', {
      type: 'phone-call.updated',
      call: expect.objectContaining({ id: 'call1' }),
    })
  })

  it('refuses a non-member of the workspace', async () => {
    mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))

    expectErr(await WhatsAppPhoneCallService.start('u2', 'ws1', 'conv1'))
    expect(mockedPlaceCall).not.toHaveBeenCalled()
  })

  it('fails when the conversation is not in the workspace', async () => {
    mockedConversationRepo.findById.mockResolvedValue(ok(null))

    expectErr(
      await WhatsAppPhoneCallService.start('u1', 'ws1', 'nope'),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    )
  })

  it('propagates repository failures', async () => {
    mockedConversationRepo.findById.mockResolvedValueOnce(
      err(databaseError('db down')),
    )
    expectErr(await WhatsAppPhoneCallService.start('u1', 'ws1', 'conv1'))

    mockedUserRepo.findById.mockResolvedValueOnce(err(databaseError('db')))
    expectErr(await WhatsAppPhoneCallService.start('u1', 'ws1', 'conv1'))

    mockedCallRepo.create.mockResolvedValueOnce(err(databaseError('db')))
    expectErr(await WhatsAppPhoneCallService.start('u1', 'ws1', 'conv1'))

    mockedCallRepo.update.mockResolvedValueOnce(err(databaseError('db')))
    expectErr(await WhatsAppPhoneCallService.start('u1', 'ws1', 'conv1'))
  })

  it('requires an extension and a device in the profile', async () => {
    mockedUserRepo.findById.mockResolvedValue(
      ok(createFakeUser({ pabxExtension: '200', pabxDeviceId: null })),
    )

    expectErr(
      await WhatsAppPhoneCallService.start('u1', 'ws1', 'conv1'),
      'PABX_EXTENSION_REQUIRED',
    )
    expect(mockedCallRepo.create).not.toHaveBeenCalled()
  })

  it('marks the call FAILED when the PABX refuses it', async () => {
    mockedPlaceCall.mockResolvedValue(err(pabxCallFailed()))

    expectErr(
      await WhatsAppPhoneCallService.start('u1', 'ws1', 'conv1'),
      'PABX_CALL_FAILED',
    )
    expect(mockedCallRepo.update).toHaveBeenCalledWith('call1', {
      status: 'FAILED',
      endedAt: expect.any(Date),
    })
  })
})

describe('WhatsAppPhoneCallService.latest()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership({ role: 'MEMBER' })),
    )
  })

  it('returns the latest call or null', async () => {
    const call = createFakeWhatsAppPhoneCall({ id: 'call1' })
    mockedCallRepo.findLatestByConversation.mockResolvedValueOnce(ok(call))
    expect(
      expectOk(await WhatsAppPhoneCallService.latest('u1', 'ws1', 'conv1'))?.id,
    ).toBe('call1')

    mockedCallRepo.findLatestByConversation.mockResolvedValueOnce(ok(null))
    expect(
      expectOk(await WhatsAppPhoneCallService.latest('u1', 'ws1', 'conv1')),
    ).toBeNull()
  })

  it('refuses a non-member and propagates repository failures', async () => {
    mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValueOnce(ok(null))
    expectErr(await WhatsAppPhoneCallService.latest('u2', 'ws1', 'conv1'))

    mockedCallRepo.findLatestByConversation.mockResolvedValueOnce(
      err(databaseError('db')),
    )
    expectErr(await WhatsAppPhoneCallService.latest('u1', 'ws1', 'conv1'))
  })
})

describe('WhatsAppPhoneCallService.handleWebhook()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function stored(overrides: Partial<WhatsAppPhoneCall>) {
    const call = createFakeWhatsAppPhoneCall({
      id: 'call1',
      workspaceId: 'ws1',
      ...overrides,
    })
    mockedCallRepo.findByCallbackTokenHash.mockResolvedValue(ok(call))
    echoUpdates(call)
    return call
  }

  it('looks the call up by the hash of the callback token', async () => {
    stored({ status: 'QUEUED' })

    await WhatsAppPhoneCallService.handleWebhook({
      token: TOKEN,
      event: 'EXTENSION_ANSWERED',
    })

    expect(mockedCallRepo.findByCallbackTokenHash).toHaveBeenCalledWith(
      createHash('sha256').update(TOKEN).digest('hex'),
    )
  })

  it('rejects an unknown callback token', async () => {
    mockedCallRepo.findByCallbackTokenHash.mockResolvedValue(ok(null))

    expectErr(
      await WhatsAppPhoneCallService.handleWebhook({
        token: TOKEN,
        event: 'HANGUP',
      }),
      'PABX_CALLBACK_INVALID',
    )
  })

  it('propagates repository failures', async () => {
    mockedCallRepo.findByCallbackTokenHash.mockResolvedValueOnce(
      err(databaseError('db')),
    )
    expectErr(
      await WhatsAppPhoneCallService.handleWebhook({
        token: TOKEN,
        event: 'HANGUP',
      }),
    )

    stored({ status: 'QUEUED' })
    mockedCallRepo.update.mockResolvedValueOnce(err(databaseError('db')))
    expectErr(
      await WhatsAppPhoneCallService.handleWebhook({
        token: TOKEN,
        event: 'ANSWERED',
      }),
    )
  })

  it('moves QUEUED → DIALING when the extension answers', async () => {
    stored({ status: 'QUEUED' })

    const call = expectOk(
      await WhatsAppPhoneCallService.handleWebhook({
        token: TOKEN,
        event: 'EXTENSION_ANSWERED',
      }),
    )

    expect(call.status).toBe('DIALING')
    expect(mockedPublish).toHaveBeenCalledWith('ws1', {
      type: 'phone-call.updated',
      call: expect.objectContaining({ status: 'DIALING' }),
    })
  })

  it('ignores a late EXTENSION_ANSWERED and a repeated ANSWERED', async () => {
    stored({ status: 'DIALING' })
    expect(
      expectOk(
        await WhatsAppPhoneCallService.handleWebhook({
          token: TOKEN,
          event: 'EXTENSION_ANSWERED',
        }),
      ).status,
    ).toBe('DIALING')

    stored({ status: 'IN_PROGRESS' })
    await WhatsAppPhoneCallService.handleWebhook({
      token: TOKEN,
      event: 'ANSWERED',
    })

    expect(mockedCallRepo.update).not.toHaveBeenCalled()
    expect(mockedPublish).not.toHaveBeenCalled()
  })

  it('moves to IN_PROGRESS when the contact answers', async () => {
    stored({ status: 'DIALING' })

    const call = expectOk(
      await WhatsAppPhoneCallService.handleWebhook({
        token: TOKEN,
        event: 'ANSWERED',
      }),
    )

    expect(call.status).toBe('IN_PROGRESS')
    expect(call.answeredAt).not.toBeNull()
  })

  it('completes an answered call with its duration', async () => {
    const answeredAt = new Date('2026-10-13T12:00:00.000Z')
    stored({ status: 'IN_PROGRESS', answeredAt })

    const call = expectOk(
      await WhatsAppPhoneCallService.handleWebhook({
        token: TOKEN,
        event: 'HANGUP',
        dialstatus: 'ANSWER',
        answeredtime: 42,
      }),
    )

    expect(call).toMatchObject({
      status: 'COMPLETED',
      durationSeconds: 42,
      answeredAt: answeredAt.toISOString(),
    })
    expect(call.endedAt).not.toBeNull()
  })

  it('back-fills answeredAt when the ANSWERED report was lost', async () => {
    stored({ status: 'DIALING' })

    const call = expectOk(
      await WhatsAppPhoneCallService.handleWebhook({
        token: TOKEN,
        event: 'HANGUP',
        dialstatus: 'ANSWER',
      }),
    )

    expect(call.status).toBe('COMPLETED')
    expect(call.durationSeconds).toBe(0)
    expect(call.answeredAt).not.toBeNull()
  })

  it.each([
    ['BUSY', 'BUSY'],
    ['NOANSWER', 'NO_ANSWER'],
    ['CANCEL', 'CANCELED'],
    ['CHANUNAVAIL', 'FAILED'],
    [undefined, 'FAILED'],
  ] as const)('maps DIALSTATUS %s to %s', async (dialstatus, status) => {
    stored({ status: 'DIALING' })

    const call = expectOk(
      await WhatsAppPhoneCallService.handleWebhook({
        token: TOKEN,
        event: 'HANGUP',
        dialstatus,
      }),
    )

    expect(call).toMatchObject({ status, durationSeconds: null })
  })

  it('records that the extension never answered', async () => {
    stored({ status: 'QUEUED' })

    const call = expectOk(
      await WhatsAppPhoneCallService.handleWebhook({
        token: TOKEN,
        event: 'EXTENSION_FAILED',
      }),
    )

    expect(call.status).toBe('EXTENSION_NO_ANSWER')
  })

  it('ignores reports after the final status', async () => {
    stored({ status: 'COMPLETED' })

    const call = expectOk(
      await WhatsAppPhoneCallService.handleWebhook({
        token: TOKEN,
        event: 'HANGUP',
        dialstatus: 'BUSY',
      }),
    )

    expect(call.status).toBe('COMPLETED')
    expect(mockedCallRepo.update).not.toHaveBeenCalled()
  })
})
