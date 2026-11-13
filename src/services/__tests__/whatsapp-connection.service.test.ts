import { describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/lib/crypto', () => ({
  encryptConnectionSecret: vi.fn(async (plain: string) => `enc:${plain}`),
  decryptConnectionSecret: vi.fn(async (envelope: string) =>
    envelope.replace(/^enc:/, ''),
  ),
}))
vi.mock('@/src/lib/whatsapp/zapi-client', () => ({
  createZapiClient: vi.fn(() => ({
    getQrCode: vi.fn(async () => ({
      status: 'awaiting_scan',
      qrCodeBase64: 'data:image/png;base64,fake',
    })),
  })),
}))

import { createZapiClient } from '@/src/lib/whatsapp/zapi-client'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppConnectionService } from '../whatsapp-connection.service'

const mockedMembershipRepo = vi.mocked(MembershipRepository)
const mockedConnectionRepo = vi.mocked(WhatsAppConnectionRepository)
const mockedCreateZapiClient = vi.mocked(createZapiClient)

const ZAPI_CREATE_INPUT = {
  provider: 'ZAPI' as const,
  label: 'Suporte',
  phoneNumber: '5511999999999',
  zapiInstanceId: 'instance-1',
  zapiToken: 'raw-token',
}

describe('WhatsAppConnectionService', () => {
  describe('list()', () => {
    it('should return connections for any workspace member', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      const connection = createFakeWhatsAppConnection({ workspaceId: 'ws1' })
      mockedConnectionRepo.listByWorkspace.mockResolvedValue(ok([connection]))

      const result = await WhatsAppConnectionService.list('u1', 'ws1')

      const dtos = expectOk(result)
      expect(dtos).toHaveLength(1)
    })

    it('should return FORBIDDEN for a non-member', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))

      const result = await WhatsAppConnectionService.list('u1', 'ws1')

      expectErr(result, 'FORBIDDEN')
    })
  })

  describe('create()', () => {
    it('should encrypt the ZAPI token and create the connection for a privileged member', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'ADMIN' })),
      )
      const created = createFakeWhatsAppConnection({
        workspaceId: 'ws1',
        provider: 'ZAPI',
      })
      mockedConnectionRepo.create.mockResolvedValue(ok(created))

      const result = await WhatsAppConnectionService.create(
        'u1',
        'ws1',
        ZAPI_CREATE_INPUT,
      )

      expectOk(result)
      expect(mockedConnectionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'ws1',
          provider: 'ZAPI',
          createdById: 'u1',
          encryptedZapiToken: 'enc:raw-token',
        }),
      )
    })

    it('should reject a plain MEMBER from creating a connection', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )

      const result = await WhatsAppConnectionService.create(
        'u1',
        'ws1',
        ZAPI_CREATE_INPUT,
      )

      expectErr(result, 'FORBIDDEN')
      expect(mockedConnectionRepo.create).not.toHaveBeenCalled()
    })

    it('should propagate a conflict from the repository', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'OWNER' })),
      )
      mockedConnectionRepo.create.mockResolvedValue(
        err({
          code: 'WHATSAPP_CONNECTION_CONFLICT',
          message: 'already exists',
        }),
      )

      const result = await WhatsAppConnectionService.create(
        'u1',
        'ws1',
        ZAPI_CREATE_INPUT,
      )

      expectErr(result, 'WHATSAPP_CONNECTION_CONFLICT')
    })
  })

  describe('remove()', () => {
    it('should delete an existing connection for a privileged member', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'OWNER' })),
      )
      const existing = createFakeWhatsAppConnection({
        id: 'conn1',
        workspaceId: 'ws1',
      })
      mockedConnectionRepo.findById.mockResolvedValue(ok(existing))
      mockedConnectionRepo.delete.mockResolvedValue(ok(undefined))

      const result = await WhatsAppConnectionService.remove(
        'u1',
        'ws1',
        'conn1',
      )

      expectOk(result)
      expect(mockedConnectionRepo.delete).toHaveBeenCalledWith('conn1')
    })

    it('should return WHATSAPP_CONNECTION_NOT_FOUND when missing', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'OWNER' })),
      )
      mockedConnectionRepo.findById.mockResolvedValue(ok(null))

      const result = await WhatsAppConnectionService.remove(
        'u1',
        'ws1',
        'conn1',
      )

      expectErr(result, 'WHATSAPP_CONNECTION_NOT_FOUND')
    })

    it('should propagate a database error', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'OWNER' })),
      )
      const existing = createFakeWhatsAppConnection({ id: 'conn1' })
      mockedConnectionRepo.findById.mockResolvedValue(ok(existing))
      mockedConnectionRepo.delete.mockResolvedValue(err(databaseError()))

      const result = await WhatsAppConnectionService.remove(
        'u1',
        'ws1',
        'conn1',
      )

      expectErr(result, 'DATABASE_ERROR')
    })
  })

  describe('refreshStatus() for Z-API ("Testar conexão")', () => {
    function owner() {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'OWNER' })),
      )
    }
    function zapiWith(getConnectionStatus: () => Promise<unknown>) {
      mockedCreateZapiClient.mockReturnValueOnce({
        getConnectionStatus: vi.fn(getConnectionStatus),
      } as unknown as ReturnType<typeof createZapiClient>)
    }

    it('should mark a paired instance CONNECTED', async () => {
      owner()
      const connection = createFakeWhatsAppConnection({
        id: 'conn1',
        provider: 'ZAPI',
      })
      mockedConnectionRepo.findById.mockResolvedValue(ok(connection))
      mockedConnectionRepo.update.mockResolvedValue(
        ok({ ...connection, status: 'CONNECTED', statusError: null }),
      )
      zapiWith(async () => ({ connected: true }))

      const dto = expectOk(
        await WhatsAppConnectionService.refreshStatus('u1', 'ws1', 'conn1'),
      )

      expect(dto.status).toBe('CONNECTED')
      expect(mockedConnectionRepo.update).toHaveBeenCalledWith('conn1', {
        status: 'CONNECTED',
        statusError: null,
      })
    })

    it('should mark an unpaired instance DISCONNECTED with a hint', async () => {
      owner()
      const connection = createFakeWhatsAppConnection({
        id: 'conn1',
        provider: 'ZAPI',
      })
      mockedConnectionRepo.findById.mockResolvedValue(ok(connection))
      mockedConnectionRepo.update.mockResolvedValue(ok(connection))
      zapiWith(async () => ({ connected: false }))

      expectOk(
        await WhatsAppConnectionService.refreshStatus('u1', 'ws1', 'conn1'),
      )

      expect(mockedConnectionRepo.update).toHaveBeenCalledWith(
        'conn1',
        expect.objectContaining({
          status: 'DISCONNECTED',
          statusError: expect.stringContaining('QR Code'),
        }),
      )
    })

    it('should record ERROR with the provider reason when Z-API fails', async () => {
      owner()
      const connection = createFakeWhatsAppConnection({
        id: 'conn1',
        provider: 'ZAPI',
      })
      mockedConnectionRepo.findById.mockResolvedValue(ok(connection))
      mockedConnectionRepo.update.mockResolvedValue(ok(connection))
      zapiWith(async () => {
        throw new Error('Client-Token ausente')
      })

      const error = expectErr(
        await WhatsAppConnectionService.refreshStatus('u1', 'ws1', 'conn1'),
        'WHATSAPP_PROVIDER_ERROR',
      )

      expect(error.message).toContain('Client-Token')
      expect(mockedConnectionRepo.update).toHaveBeenCalledWith('conn1', {
        status: 'ERROR',
        statusError: 'Client-Token ausente',
      })
    })

    it('should use a generic reason when the failure has no message', async () => {
      owner()
      const connection = createFakeWhatsAppConnection({
        id: 'conn1',
        provider: 'ZAPI',
      })
      mockedConnectionRepo.findById.mockResolvedValue(ok(connection))
      mockedConnectionRepo.update.mockResolvedValue(ok(connection))
      zapiWith(async () => {
        throw 'boom'
      })

      const error = expectErr(
        await WhatsAppConnectionService.refreshStatus('u1', 'ws1', 'conn1'),
        'WHATSAPP_PROVIDER_ERROR',
      )

      expect(error.message).toBe('Falha ao comunicar com a Z-API')
    })

    it('should reject a Z-API connection without credentials', async () => {
      owner()
      mockedConnectionRepo.findById.mockResolvedValue(
        ok(
          createFakeWhatsAppConnection({
            provider: 'ZAPI',
            zapiInstanceId: null,
          }),
        ),
      )

      expectErr(
        await WhatsAppConnectionService.refreshStatus('u1', 'ws1', 'conn1'),
        'BAD_REQUEST',
      )
    })

    it('should include the Z-API client token when the instance has one', async () => {
      owner()
      const connection = createFakeWhatsAppConnection({
        id: 'conn1',
        provider: 'ZAPI',
        encryptedZapiClientToken: 'enc:client',
      })
      mockedConnectionRepo.findById.mockResolvedValue(ok(connection))
      mockedConnectionRepo.update.mockResolvedValue(ok(connection))
      zapiWith(async () => ({ connected: true }))

      expectOk(
        await WhatsAppConnectionService.refreshStatus('u1', 'ws1', 'conn1'),
      )

      expect(mockedCreateZapiClient).toHaveBeenLastCalledWith(
        expect.objectContaining({ clientToken: 'client' }),
      )
    })
  })

  describe('getQrCode()', () => {
    it('should return the QR code for a ZAPI connection', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'OWNER' })),
      )
      const connection = createFakeWhatsAppConnection({
        id: 'conn1',
        provider: 'ZAPI',
        status: 'CONNECTING',
      })
      mockedConnectionRepo.findById.mockResolvedValue(ok(connection))

      const result = await WhatsAppConnectionService.getQrCode(
        'u1',
        'ws1',
        'conn1',
      )

      const qr = expectOk(result)
      expect(qr.status).toBe('awaiting_scan')
      expect(mockedCreateZapiClient).toHaveBeenCalled()
    })

    it('should turn a Z-API failure into a provider error and keep the reason', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'OWNER' })),
      )
      const connection = createFakeWhatsAppConnection({
        id: 'conn1',
        provider: 'ZAPI',
        status: 'CONNECTING',
      })
      mockedConnectionRepo.findById.mockResolvedValue(ok(connection))
      mockedConnectionRepo.update.mockResolvedValue(ok(connection))
      mockedCreateZapiClient.mockReturnValueOnce({
        getQrCode: vi.fn(async () => {
          throw new Error('A Z-API recusou a chamada: Client-Token ausente')
        }),
      } as unknown as ReturnType<typeof createZapiClient>)

      const result = await WhatsAppConnectionService.getQrCode(
        'u1',
        'ws1',
        'conn1',
      )

      const error = expectErr(result, 'WHATSAPP_PROVIDER_ERROR')
      expect(error.message).toContain('Client-Token')
      expect(mockedConnectionRepo.update).toHaveBeenCalledWith('conn1', {
        statusError: 'A Z-API recusou a chamada: Client-Token ausente',
      })
    })

    it('should fall back to a generic message when the failure has none', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'OWNER' })),
      )
      const connection = createFakeWhatsAppConnection({
        id: 'conn1',
        provider: 'ZAPI',
      })
      mockedConnectionRepo.findById.mockResolvedValue(ok(connection))
      mockedConnectionRepo.update.mockResolvedValue(ok(connection))
      mockedCreateZapiClient.mockReturnValueOnce({
        getQrCode: vi.fn(async () => {
          throw 'boom'
        }),
      } as unknown as ReturnType<typeof createZapiClient>)

      const result = await WhatsAppConnectionService.getQrCode(
        'u1',
        'ws1',
        'conn1',
      )

      const error = expectErr(result, 'WHATSAPP_PROVIDER_ERROR')
      expect(error.message).toBe('Falha ao comunicar com a Z-API')
    })

    it('should reject QR code requests for a META connection', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'OWNER' })),
      )
      const connection = createFakeWhatsAppConnection({
        id: 'conn1',
        provider: 'META',
      })
      mockedConnectionRepo.findById.mockResolvedValue(ok(connection))

      const result = await WhatsAppConnectionService.getQrCode(
        'u1',
        'ws1',
        'conn1',
      )

      expectErr(result, 'BAD_REQUEST')
    })
  })
})
