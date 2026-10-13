import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeUser } from '@/src/__tests__/factories/user.factory'
import { createFakeWhatsAppConversationWithPreview } from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { pabxCallFailed } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/user.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/lib/pabx/click-to-call', () => ({
  placePabxCall: vi.fn(),
}))

import { placePabxCall } from '@/src/lib/pabx/click-to-call'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { UserRepository } from '@/src/repositories/user.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppPhoneCallService } from '../whatsapp-phone-call.service'

const mockedMembershipRepo = vi.mocked(MembershipRepository)
const mockedUserRepo = vi.mocked(UserRepository)
const mockedConversationRepo = vi.mocked(WhatsAppConversationRepository)
const mockedPlaceCall = vi.mocked(placePabxCall)

function conversationWithContact(waId: string) {
  const conversation = createFakeWhatsAppConversationWithPreview({
    id: 'conv1',
  })
  return { ...conversation, contact: { ...conversation.contact, waId } }
}

describe('WhatsAppPhoneCallService.start()', () => {
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
    mockedPlaceCall.mockResolvedValue(ok({ destination: '11999999999' }))
  })

  it("rings the actor's extension to the conversation contact", async () => {
    const result = await WhatsAppPhoneCallService.start('u1', 'ws1', 'conv1', {
      mode: 'RECORDING',
    })

    expect(expectOk(result)).toEqual({
      conversationId: 'conv1',
      extension: '200',
      destination: '11999999999',
      mode: 'RECORDING',
    })
    expect(mockedPlaceCall).toHaveBeenCalledWith({
      deviceId: '123',
      extension: '200',
      destination: '5511999999999',
      mode: 'RECORDING',
    })
  })

  it('refuses a non-member of the workspace', async () => {
    mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))

    const result = await WhatsAppPhoneCallService.start('u2', 'ws1', 'conv1', {
      mode: 'DIRECT',
    })

    expectErr(result)
    expect(mockedPlaceCall).not.toHaveBeenCalled()
  })

  it('fails when the conversation is not in the workspace', async () => {
    mockedConversationRepo.findById.mockResolvedValue(ok(null))

    const result = await WhatsAppPhoneCallService.start('u1', 'ws1', 'nope', {
      mode: 'DIRECT',
    })

    expectErr(result, 'WHATSAPP_CONVERSATION_NOT_FOUND')
  })

  it('propagates a repository failure on the conversation lookup', async () => {
    mockedConversationRepo.findById.mockResolvedValue(
      err(pabxCallFailed('db down')),
    )

    const result = await WhatsAppPhoneCallService.start('u1', 'ws1', 'conv1', {
      mode: 'DIRECT',
    })

    expect(result.ok).toBe(false)
  })

  it('propagates a repository failure on the actor lookup', async () => {
    mockedUserRepo.findById.mockResolvedValue(err(pabxCallFailed('db down')))

    const result = await WhatsAppPhoneCallService.start('u1', 'ws1', 'conv1', {
      mode: 'DIRECT',
    })

    expect(result.ok).toBe(false)
    expect(mockedPlaceCall).not.toHaveBeenCalled()
  })

  it('requires an extension and a device in the profile', async () => {
    mockedUserRepo.findById.mockResolvedValue(
      ok(createFakeUser({ pabxExtension: '200', pabxDeviceId: null })),
    )

    const result = await WhatsAppPhoneCallService.start('u1', 'ws1', 'conv1', {
      mode: 'DIRECT',
    })

    expectErr(result, 'PABX_EXTENSION_REQUIRED')
    expect(mockedPlaceCall).not.toHaveBeenCalled()
  })

  it('returns the dialer failure', async () => {
    mockedPlaceCall.mockResolvedValue(err(pabxCallFailed()))

    const result = await WhatsAppPhoneCallService.start('u1', 'ws1', 'conv1', {
      mode: 'DIRECT',
    })

    expectErr(result, 'PABX_CALL_FAILED')
  })
})
