import { describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import {
  createFakeWhatsAppGroupParticipant,
  createFakeWhatsAppGroupWithParticipants,
} from '@/src/__tests__/factories/whatsapp-group.factory'
import { createFakeWhatsAppGroupMessage } from '@/src/__tests__/factories/whatsapp-group-message.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { ok } from '@/src/lib/result'

// Business hours: open unless a test says otherwise.
vi.mock('@/src/services/whatsapp-business-hours.service', () => ({
  WhatsAppBusinessHoursService: {
    assertOpen: vi.fn(async () => ({ ok: true, value: undefined })),
    check: vi.fn(async () => ({
      ok: true,
      value: { open: true, nextOpeningAt: null, hours: {} },
    })),
  },
}))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-group.repository')
vi.mock('@/src/repositories/whatsapp-group-message.repository')
vi.mock('@/src/lib/crypto', () => ({
  decryptConnectionSecret: vi.fn(async (envelope: string) =>
    envelope.replace(/^enc:/, ''),
  ),
}))
vi.mock('@/src/lib/rate-limit', () => ({
  consume: vi.fn(async () => ({ ok: true, value: undefined })),
  whatsappSendLimiter: { __mock: 'whatsappSendLimiter' },
}))
vi.mock('@/src/lib/whatsapp/send', () => ({
  WhatsAppSend: {
    text: vi.fn(async () => ({
      ok: true,
      value: { providerMessageId: 'pm1' },
    })),
  },
}))
vi.mock('@/src/lib/whatsapp/zapi-groups', () => ({
  createZapiGroup: vi.fn(async () => ({
    groupJid: '120363000000000000@g.us',
    phonesNotAdded: [],
    inviteLink: 'https://chat.whatsapp.com/abc',
  })),
  updateZapiGroupName: vi.fn(async () => undefined),
  updateZapiGroupPhoto: vi.fn(async () => undefined),
  updateZapiGroupDescription: vi.fn(async () => undefined),
  addZapiGroupParticipants: vi.fn(async () => undefined),
  removeZapiGroupParticipants: vi.fn(async () => undefined),
  setZapiGroupAdmin: vi.fn(async () => undefined),
  leaveZapiGroup: vi.fn(async () => undefined),
  getZapiGroupMetadata: vi.fn(async () => ({
    phone: '120363000000000000@g.us',
    subject: 'Time de Suporte',
    participants: [{ phone: '5511988887777', isAdmin: false }],
  })),
  getZapiGroupInviteLink: vi.fn(async () => 'https://chat.whatsapp.com/abc'),
}))

import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import {
  addZapiGroupParticipants,
  createZapiGroup,
  getZapiGroupInviteLink,
  getZapiGroupMetadata,
  leaveZapiGroup,
  removeZapiGroupParticipants,
  setZapiGroupAdmin,
  updateZapiGroupDescription,
  updateZapiGroupName,
} from '@/src/lib/whatsapp/zapi-groups'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppGroupRepository } from '@/src/repositories/whatsapp-group.repository'
import { WhatsAppGroupMessageRepository } from '@/src/repositories/whatsapp-group-message.repository'
import { WhatsAppGroupService } from '../whatsapp-group.service'

const mockedMembershipRepo = vi.mocked(MembershipRepository)
const mockedConnectionRepo = vi.mocked(WhatsAppConnectionRepository)
const mockedGroupRepo = vi.mocked(WhatsAppGroupRepository)
const mockedGroupMessageRepo = vi.mocked(WhatsAppGroupMessageRepository)
const mockedSend = vi.mocked(WhatsAppSend)

function mockMember() {
  mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'MEMBER' })),
  )
}

function mockZapiConnection(overrides: { id?: string } = {}) {
  const connection = createFakeWhatsAppConnection({
    id: overrides.id ?? 'conn1',
    workspaceId: 'ws1',
    provider: 'ZAPI',
    zapiInstanceId: 'instance-1',
    encryptedZapiToken: 'enc:token',
  })
  mockedConnectionRepo.findById.mockResolvedValue(ok(connection))
  return connection
}

describe('WhatsAppGroupService', () => {
  describe('create()', () => {
    it('should create a group against a Z-API connection', async () => {
      mockMember()
      mockZapiConnection()
      const group = createFakeWhatsAppGroupWithParticipants({
        id: 'g1',
        connectionId: 'conn1',
      })
      mockedGroupRepo.create.mockResolvedValue(ok(group))
      mockedGroupRepo.replaceParticipants.mockResolvedValue(ok(undefined))
      mockedGroupRepo.findById.mockResolvedValue(ok(group))

      const result = await WhatsAppGroupService.create('u1', 'ws1', {
        connectionId: 'conn1',
        name: 'Time de Suporte',
        participantWaIds: ['5511988887777'],
      })

      const dto = expectOk(result)
      expect(dto.id).toBe('g1')
      expect(createZapiGroup).toHaveBeenCalled()
      expect(mockedGroupRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'ws1',
          connectionId: 'conn1',
          groupJid: '120363000000000000@g.us',
          name: 'Time de Suporte',
        }),
      )
    })

    it('should reject creating a group on a Meta connection', async () => {
      mockMember()
      const connection = createFakeWhatsAppConnection({
        id: 'conn-meta',
        workspaceId: 'ws1',
        provider: 'META',
      })
      mockedConnectionRepo.findById.mockResolvedValue(ok(connection))

      const result = await WhatsAppGroupService.create('u1', 'ws1', {
        connectionId: 'conn-meta',
        name: 'Time de Suporte',
        participantWaIds: ['5511988887777'],
      })

      expectErr(result, 'WHATSAPP_GROUP_PROVIDER_UNSUPPORTED')
      expect(createZapiGroup).not.toHaveBeenCalled()
    })
  })

  describe('updateInfo()', () => {
    it('should push name/description changes to Z-API and persist locally', async () => {
      mockMember()
      mockZapiConnection()
      const group = createFakeWhatsAppGroupWithParticipants({
        id: 'g1',
        connectionId: 'conn1',
      })
      mockedGroupRepo.findById.mockResolvedValue(ok(group))
      mockedGroupRepo.update.mockResolvedValue(ok(group))

      const result = await WhatsAppGroupService.updateInfo('u1', 'ws1', 'g1', {
        name: 'Novo nome',
        description: 'Nova descrição',
      })

      expectOk(result)
      expect(updateZapiGroupName).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ name: 'Novo nome' }),
      )
      expect(updateZapiGroupDescription).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ description: 'Nova descrição' }),
      )
      expect(mockedGroupRepo.update).toHaveBeenCalledWith('g1', {
        name: 'Novo nome',
        description: 'Nova descrição',
      })
    })

    it('should return WHATSAPP_GROUP_NOT_FOUND when missing', async () => {
      mockMember()
      mockedGroupRepo.findById.mockResolvedValue(ok(null))

      const result = await WhatsAppGroupService.updateInfo('u1', 'ws1', 'g1', {
        name: 'Novo nome',
      })

      expectErr(result, 'WHATSAPP_GROUP_NOT_FOUND')
    })
  })

  describe('addParticipants()', () => {
    it('should add participants and re-sync from provider metadata', async () => {
      mockMember()
      mockZapiConnection()
      const group = createFakeWhatsAppGroupWithParticipants({
        id: 'g1',
        connectionId: 'conn1',
      })
      mockedGroupRepo.findById.mockResolvedValue(ok(group))
      mockedGroupRepo.replaceParticipants.mockResolvedValue(ok(undefined))

      const result = await WhatsAppGroupService.addParticipants(
        'u1',
        'ws1',
        'g1',
        { waIds: ['5511988887777'] },
      )

      expectOk(result)
      expect(addZapiGroupParticipants).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ phones: ['5511988887777'] }),
      )
      expect(getZapiGroupMetadata).toHaveBeenCalled()
      expect(mockedGroupRepo.replaceParticipants).toHaveBeenCalledWith('g1', [
        { waId: '5511988887777', role: 'MEMBER' },
      ])
    })
  })

  describe('removeParticipants()', () => {
    it('should remove participants and re-sync from provider metadata', async () => {
      mockMember()
      mockZapiConnection()
      const group = createFakeWhatsAppGroupWithParticipants({
        id: 'g1',
        connectionId: 'conn1',
      })
      mockedGroupRepo.findById.mockResolvedValue(ok(group))
      mockedGroupRepo.replaceParticipants.mockResolvedValue(ok(undefined))

      const result = await WhatsAppGroupService.removeParticipants(
        'u1',
        'ws1',
        'g1',
        { waIds: ['5511988887777'] },
      )

      expectOk(result)
      expect(removeZapiGroupParticipants).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ phones: ['5511988887777'] }),
      )
    })
  })

  describe('setAdmin()', () => {
    it('should promote a participant to admin', async () => {
      mockMember()
      mockZapiConnection()
      const group = createFakeWhatsAppGroupWithParticipants({
        id: 'g1',
        connectionId: 'conn1',
      })
      mockedGroupRepo.findById.mockResolvedValue(ok(group))
      mockedGroupRepo.replaceParticipants.mockResolvedValue(ok(undefined))

      const result = await WhatsAppGroupService.setAdmin('u1', 'ws1', 'g1', {
        waId: '5511988887777',
        admin: true,
      })

      expectOk(result)
      expect(setZapiGroupAdmin).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ phone: '5511988887777', admin: true }),
      )
    })
  })

  describe('getInviteLink()', () => {
    it('should fetch and persist the invite link', async () => {
      mockMember()
      mockZapiConnection()
      const group = createFakeWhatsAppGroupWithParticipants({
        id: 'g1',
        connectionId: 'conn1',
      })
      mockedGroupRepo.findById.mockResolvedValue(ok(group))
      mockedGroupRepo.update.mockResolvedValue(ok(group))

      const result = await WhatsAppGroupService.getInviteLink('u1', 'ws1', 'g1')

      const value = expectOk(result)
      expect(value.inviteLink).toBe('https://chat.whatsapp.com/abc')
      expect(getZapiGroupInviteLink).toHaveBeenCalled()
      expect(mockedGroupRepo.update).toHaveBeenCalledWith('g1', {
        inviteLink: 'https://chat.whatsapp.com/abc',
      })
    })
  })

  describe('leave()', () => {
    it('should leave the group on the provider and archive it locally', async () => {
      mockMember()
      mockZapiConnection()
      const group = createFakeWhatsAppGroupWithParticipants({
        id: 'g1',
        connectionId: 'conn1',
      })
      mockedGroupRepo.findById.mockResolvedValue(ok(group))
      mockedGroupRepo.update.mockResolvedValue(ok(group))

      const result = await WhatsAppGroupService.leave('u1', 'ws1', 'g1')

      const value = expectOk(result)
      expect(value).toEqual({ id: 'g1' })
      expect(leaveZapiGroup).toHaveBeenCalled()
      expect(mockedGroupRepo.update).toHaveBeenCalledWith('g1', {
        archivedAt: expect.any(Date),
      })
    })
  })

  describe('sendText()', () => {
    it('should send a group text message and persist the sender', async () => {
      mockMember()
      mockZapiConnection()
      const group = createFakeWhatsAppGroupWithParticipants({
        id: 'g1',
        connectionId: 'conn1',
        groupJid: '120363000000000000@g.us',
      })
      mockedGroupRepo.findById.mockResolvedValue(ok(group))
      const created = createFakeWhatsAppGroupMessage({
        groupId: 'g1',
        direction: 'OUT',
        text: 'Olá time',
        senderUserId: 'u1',
        senderWaId: null,
        senderName: null,
      })
      mockedGroupMessageRepo.create.mockResolvedValue(ok(created))
      mockedGroupRepo.update.mockResolvedValue(ok(group))

      const result = await WhatsAppGroupService.sendText('u1', 'ws1', 'g1', {
        text: 'Olá time',
      })

      const dto = expectOk(result)
      expect(dto.direction).toBe('OUT')
      expect(mockedSend.text).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          to: '120363000000000000@g.us',
          text: 'Olá time',
        }),
      )
      expect(mockedGroupMessageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          groupId: 'g1',
          direction: 'OUT',
          senderUserId: 'u1',
        }),
      )
    })

    it('should return WHATSAPP_GROUP_NOT_FOUND for a missing group', async () => {
      mockMember()
      mockedGroupRepo.findById.mockResolvedValue(ok(null))

      const result = await WhatsAppGroupService.sendText('u1', 'ws1', 'g1', {
        text: 'Olá time',
      })

      expectErr(result, 'WHATSAPP_GROUP_NOT_FOUND')
      expect(mockedSend.text).not.toHaveBeenCalled()
    })
  })

  describe('listMessages()', () => {
    it('should return the group message history', async () => {
      mockMember()
      const group = createFakeWhatsAppGroupWithParticipants({ id: 'g1' })
      mockedGroupRepo.findById.mockResolvedValue(ok(group))
      mockedGroupMessageRepo.listByGroup.mockResolvedValue(
        ok([
          createFakeWhatsAppGroupMessage(),
          createFakeWhatsAppGroupMessage(),
        ]),
      )

      const result = await WhatsAppGroupService.listMessages(
        'u1',
        'ws1',
        'g1',
        { limit: 50 },
      )

      const dtos = expectOk(result)
      expect(dtos).toHaveLength(2)
    })
  })

  describe('list()', () => {
    it('should return groups for a workspace member', async () => {
      mockMember()
      mockedGroupRepo.listByWorkspace.mockResolvedValue(
        ok([
          createFakeWhatsAppGroupWithParticipants({
            participants: [createFakeWhatsAppGroupParticipant()],
          }),
        ]),
      )

      const result = await WhatsAppGroupService.list('u1', 'ws1', {})

      const dtos = expectOk(result)
      expect(dtos).toHaveLength(1)
    })

    it('should return FORBIDDEN for a non-member', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))

      const result = await WhatsAppGroupService.list('u1', 'ws1', {})

      expectErr(result, 'FORBIDDEN')
    })
  })
})
