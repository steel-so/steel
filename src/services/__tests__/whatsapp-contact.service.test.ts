import { describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppContact } from '@/src/__tests__/factories/whatsapp-contact.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-contact.repository')
vi.mock('@/src/lib/crypto', () => ({
  decryptConnectionSecret: vi.fn(async (envelope: string) =>
    envelope.replace(/^enc:/, ''),
  ),
}))
vi.mock('@/src/lib/whatsapp/zapi-client', () => ({
  getZapiContactProfilePicture: vi.fn(
    async () => 'https://cdn.z-api/photo.jpg',
  ),
}))

import { getZapiContactProfilePicture } from '@/src/lib/whatsapp/zapi-client'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { WhatsAppContactService } from '../whatsapp-contact.service'

const mockedMembershipRepo = vi.mocked(MembershipRepository)
const mockedConnectionRepo = vi.mocked(WhatsAppConnectionRepository)
const mockedContactRepo = vi.mocked(WhatsAppContactRepository)
const mockedGetProfilePicture = vi.mocked(getZapiContactProfilePicture)

describe('WhatsAppContactService', () => {
  describe('list()', () => {
    it('should return contacts for a workspace member', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      mockedContactRepo.listByWorkspace.mockResolvedValue(
        ok([createFakeWhatsAppContact({ workspaceId: 'ws1' })]),
      )

      const result = await WhatsAppContactService.list('u1', 'ws1', {})

      const dtos = expectOk(result)
      expect(dtos).toHaveLength(1)
      expect(mockedContactRepo.listByWorkspace).toHaveBeenCalledWith(
        'ws1',
        undefined,
        undefined,
        undefined,
      )
    })

    it('should pass the "tem zap?" filter to the repository', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      mockedContactRepo.listByWorkspace.mockResolvedValue(ok([]))

      await WhatsAppContactService.list('u1', 'ws1', {
        search: 'ana',
        whatsapp: 'no',
      })

      expect(mockedContactRepo.listByWorkspace).toHaveBeenCalledWith(
        'ws1',
        'ana',
        'no',
        undefined,
      )
    })

    it('should pass the São Paulo start of today for the "inserted today" filter', async () => {
      vi.useFakeTimers()
      // 22:30 in São Paulo on the 27th — UTC already turned the day.
      vi.setSystemTime(new Date('2026-10-28T01:30:00Z'))
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      mockedContactRepo.listByWorkspace.mockResolvedValue(ok([]))

      await WhatsAppContactService.list('u1', 'ws1', { created: 'today' })
      vi.useRealTimers()

      expect(mockedContactRepo.listByWorkspace).toHaveBeenCalledWith(
        'ws1',
        undefined,
        undefined,
        new Date('2026-10-27T03:00:00Z'),
      )
    })

    it('should return FORBIDDEN for a non-member', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))

      const result = await WhatsAppContactService.list('u1', 'ws1', {})

      expectErr(result, 'FORBIDDEN')
    })
  })

  describe('create()', () => {
    it('should create a contact for any member', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      const created = createFakeWhatsAppContact({
        workspaceId: 'ws1',
        waId: '5511988887777',
      })
      mockedContactRepo.create.mockResolvedValue(ok(created))

      const result = await WhatsAppContactService.create('u1', 'ws1', {
        waId: '5511988887777',
      })

      const dto = expectOk(result)
      expect(dto.waId).toBe('5511988887777')
    })

    it('should propagate a conflict when the contact already exists', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      mockedContactRepo.create.mockResolvedValue(
        err({ code: 'CONFLICT', message: 'Este contato já existe' }),
      )

      const result = await WhatsAppContactService.create('u1', 'ws1', {
        waId: '5511988887777',
      })

      expectErr(result, 'CONFLICT')
    })
  })

  describe('findOrCreate()', () => {
    it('should upsert the contact by waId', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      const upserted = createFakeWhatsAppContact({
        waId: '5511988887777',
        name: 'Maria',
      })
      mockedContactRepo.upsertByWaId.mockResolvedValue(ok(upserted))

      const result = await WhatsAppContactService.findOrCreate('u1', 'ws1', {
        waId: '5511988887777',
        name: 'Maria',
      })

      const dto = expectOk(result)
      expect(dto.waId).toBe('5511988887777')
      expect(mockedContactRepo.upsertByWaId).toHaveBeenCalledWith({
        workspaceId: 'ws1',
        waId: '5511988887777',
        name: 'Maria',
      })
    })

    it('should return FORBIDDEN for a non-member', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))

      const result = await WhatsAppContactService.findOrCreate('u1', 'ws1', {
        waId: '5511988887777',
      })

      expectErr(result, 'FORBIDDEN')
      expect(mockedContactRepo.upsertByWaId).not.toHaveBeenCalled()
    })
  })

  describe('syncAvatar()', () => {
    it('should fetch and persist the profile picture from a Z-API connection', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      const contact = createFakeWhatsAppContact({
        id: 'ct1',
        waId: '5511988887777',
      })
      mockedContactRepo.findById.mockResolvedValue(ok(contact))
      mockedConnectionRepo.listByWorkspace.mockResolvedValue(
        ok([
          createFakeWhatsAppConnection({ provider: 'META' }),
          createFakeWhatsAppConnection({
            provider: 'ZAPI',
            zapiInstanceId: 'instance-1',
            encryptedZapiToken: 'enc:token',
          }),
        ]),
      )
      mockedContactRepo.update.mockResolvedValue(
        ok(
          createFakeWhatsAppContact({
            id: 'ct1',
            avatarUrl: 'https://cdn.z-api/photo.jpg',
          }),
        ),
      )

      const result = await WhatsAppContactService.syncAvatar('u1', 'ws1', 'ct1')

      const dto = expectOk(result)
      expect(dto.avatarUrl).toBe('https://cdn.z-api/photo.jpg')
      expect(mockedGetProfilePicture).toHaveBeenCalledWith(
        expect.objectContaining({ instanceId: 'instance-1', token: 'token' }),
        '5511988887777',
      )
      expect(mockedContactRepo.update).toHaveBeenCalledWith('ct1', {
        avatarUrl: 'https://cdn.z-api/photo.jpg',
      })
    })

    it('should return WHATSAPP_CONTACT_PHOTO_UNAVAILABLE without a Z-API connection', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      const contact = createFakeWhatsAppContact({ id: 'ct1' })
      mockedContactRepo.findById.mockResolvedValue(ok(contact))
      mockedConnectionRepo.listByWorkspace.mockResolvedValue(
        ok([createFakeWhatsAppConnection({ provider: 'META' })]),
      )

      const result = await WhatsAppContactService.syncAvatar('u1', 'ws1', 'ct1')

      expectErr(result, 'WHATSAPP_CONTACT_PHOTO_UNAVAILABLE')
      expect(mockedGetProfilePicture).not.toHaveBeenCalled()
    })

    it('should return WHATSAPP_CONTACT_PHOTO_UNAVAILABLE when Z-API has no picture on file', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      const contact = createFakeWhatsAppContact({ id: 'ct1' })
      mockedContactRepo.findById.mockResolvedValue(ok(contact))
      mockedConnectionRepo.listByWorkspace.mockResolvedValue(
        ok([
          createFakeWhatsAppConnection({
            provider: 'ZAPI',
            zapiInstanceId: 'instance-1',
            encryptedZapiToken: 'enc:token',
          }),
        ]),
      )
      mockedGetProfilePicture.mockResolvedValueOnce(null)

      const result = await WhatsAppContactService.syncAvatar('u1', 'ws1', 'ct1')

      expectErr(result, 'WHATSAPP_CONTACT_PHOTO_UNAVAILABLE')
      expect(mockedContactRepo.update).not.toHaveBeenCalled()
    })

    it('should return WHATSAPP_CONTACT_NOT_FOUND when missing', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      mockedContactRepo.findById.mockResolvedValue(ok(null))

      const result = await WhatsAppContactService.syncAvatar('u1', 'ws1', 'ct1')

      expectErr(result, 'WHATSAPP_CONTACT_NOT_FOUND')
    })
  })

  describe('remove()', () => {
    it('should delete an existing contact', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'ADMIN' })),
      )
      const existing = createFakeWhatsAppContact({ id: 'ct1' })
      mockedContactRepo.findById.mockResolvedValue(ok(existing))
      mockedContactRepo.delete.mockResolvedValue(ok(undefined))

      const result = await WhatsAppContactService.remove('u1', 'ws1', 'ct1')

      expectOk(result)
      expect(mockedContactRepo.delete).toHaveBeenCalledWith('ct1')
    })

    it('should return WHATSAPP_CONTACT_NOT_FOUND when missing', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'ADMIN' })),
      )
      mockedContactRepo.findById.mockResolvedValue(ok(null))

      const result = await WhatsAppContactService.remove('u1', 'ws1', 'ct1')

      expectErr(result, 'WHATSAPP_CONTACT_NOT_FOUND')
    })

    it('should propagate a database error', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'ADMIN' })),
      )
      const existing = createFakeWhatsAppContact({ id: 'ct1' })
      mockedContactRepo.findById.mockResolvedValue(ok(existing))
      mockedContactRepo.delete.mockResolvedValue(err(databaseError()))

      const result = await WhatsAppContactService.remove('u1', 'ws1', 'ct1')

      expectErr(result, 'DATABASE_ERROR')
    })
  })

  describe('setBroadcastOptOut()', () => {
    it('should return MODULE_DISABLED when Comunicação is off', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'OWNER' })),
      )
      vi.mocked(
        WorkspaceModuleAccessRepository.isEnabled,
      ).mockResolvedValueOnce(ok(false))

      expectErr(
        await WhatsAppContactService.setBroadcastOptOut('u1', 'ws1', 'ct1', {
          optedOut: true,
        }),
        'MODULE_DISABLED',
      )
      expect(mockedContactRepo.setBroadcastOptOut).not.toHaveBeenCalled()
    })

    it('should return FORBIDDEN for a non-admin member', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )

      expectErr(
        await WhatsAppContactService.setBroadcastOptOut('u1', 'ws1', 'ct1', {
          optedOut: true,
        }),
        'FORBIDDEN',
      )
      expect(mockedContactRepo.setBroadcastOptOut).not.toHaveBeenCalled()
    })

    it('should return WHATSAPP_CONTACT_NOT_FOUND for a contact of another workspace', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'ADMIN' })),
      )
      mockedContactRepo.findById.mockResolvedValue(ok(null))

      expectErr(
        await WhatsAppContactService.setBroadcastOptOut('u1', 'ws1', 'ct1', {
          optedOut: true,
        }),
        'WHATSAPP_CONTACT_NOT_FOUND',
      )
    })

    it('should record an admin opt-out', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'ADMIN' })),
      )
      const contact = createFakeWhatsAppContact({ id: 'ct1' })
      mockedContactRepo.findById.mockResolvedValue(ok(contact))
      mockedContactRepo.setBroadcastOptOut.mockResolvedValue(
        ok({
          ...contact,
          broadcastOptedOutAt: new Date(),
          broadcastOptOutSource: 'ADMIN',
        }),
      )

      const dto = expectOk(
        await WhatsAppContactService.setBroadcastOptOut('u1', 'ws1', 'ct1', {
          optedOut: true,
        }),
      )
      expect(dto.broadcastOptOutSource).toBe('ADMIN')
      expect(mockedContactRepo.setBroadcastOptOut).toHaveBeenCalledWith('ct1', {
        at: expect.any(Date),
        source: 'ADMIN',
      })
    })

    it('should re-subscribe only when the contact requested it', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'OWNER' })),
      )
      const contact = createFakeWhatsAppContact({
        id: 'ct1',
        broadcastOptedOutAt: new Date(),
        broadcastOptOutSource: 'KEYWORD',
      })
      mockedContactRepo.findById.mockResolvedValue(ok(contact))
      mockedContactRepo.setBroadcastOptOut.mockResolvedValue(
        ok({
          ...contact,
          broadcastOptedOutAt: null,
          broadcastOptOutSource: null,
        }),
      )

      expectErr(
        await WhatsAppContactService.setBroadcastOptOut('u1', 'ws1', 'ct1', {
          optedOut: false,
        }),
        'VALIDATION_ERROR',
      )
      expect(mockedContactRepo.setBroadcastOptOut).not.toHaveBeenCalled()

      const dto = expectOk(
        await WhatsAppContactService.setBroadcastOptOut('u1', 'ws1', 'ct1', {
          optedOut: false,
          contactRequested: true,
        }),
      )
      expect(dto.broadcastOptedOutAt).toBeNull()
      expect(mockedContactRepo.setBroadcastOptOut).toHaveBeenCalledWith(
        'ct1',
        null,
      )
    })
  })
})
