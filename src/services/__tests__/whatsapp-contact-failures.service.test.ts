import { describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppContact } from '@/src/__tests__/factories/whatsapp-contact.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import type { AppError } from '@/src/errors/app-error'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-contact.repository')
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/lib/crypto', () => ({
  decryptConnectionSecret: vi.fn(async (envelope: string) =>
    envelope.replace(/^enc:/, ''),
  ),
}))
vi.mock('@/src/lib/whatsapp/zapi-client', () => ({
  getZapiContactProfilePicture: vi.fn(),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { getZapiContactProfilePicture } from '@/src/lib/whatsapp/zapi-client'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppContactService } from '../whatsapp-contact.service'

const mockedMembershipRepo = vi.mocked(MembershipRepository)
const mockedConnectionRepo = vi.mocked(WhatsAppConnectionRepository)
const mockedContactRepo = vi.mocked(WhatsAppContactRepository)
const mockedGetProfilePicture = vi.mocked(getZapiContactProfilePicture)

const DB_ERROR: AppError = { code: 'DATABASE_ERROR', message: 'db down' }

function asAdmin() {
  mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'ADMIN' })),
  )
}

function asNonMember() {
  mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
}

const contact = () =>
  createFakeWhatsAppContact({ id: 'ct1', workspaceId: 'ws1', waId: '5511' })

describe('WhatsAppContactService — list/create/findOrCreate failures', () => {
  it('list() should propagate a repository failure', async () => {
    asAdmin()
    mockedContactRepo.listByWorkspace.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppContactService.list('u1', 'ws1', { search: 'ana' }),
      'DATABASE_ERROR',
    )
    expect(mockedContactRepo.listByWorkspace).toHaveBeenCalledWith(
      'ws1',
      'ana',
      undefined,
      undefined,
    )
  })

  it('create() should return FORBIDDEN for a non-member', async () => {
    asNonMember()

    expectErr(
      await WhatsAppContactService.create('u1', 'ws1', { waId: '5511' }),
      'FORBIDDEN',
    )
    expect(mockedContactRepo.create).not.toHaveBeenCalled()
  })

  it('findOrCreate() should propagate an upsert failure', async () => {
    asAdmin()
    mockedContactRepo.upsertByWaId.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppContactService.findOrCreate('u1', 'ws1', { waId: '5511' }),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppContactService.syncAvatar() failures', () => {
  function arrangeSync() {
    asAdmin()
    mockedContactRepo.findById.mockResolvedValue(ok(contact()))
    mockedConnectionRepo.listByWorkspace.mockResolvedValue(
      ok([
        createFakeWhatsAppConnection({
          provider: 'ZAPI',
          zapiInstanceId: 'instance-1',
          encryptedZapiToken: 'enc:token',
          encryptedZapiClientToken: 'enc:client',
        }),
      ]),
    )
    mockedGetProfilePicture.mockResolvedValue('https://cdn.z-api/p.jpg')
    mockedContactRepo.update.mockResolvedValue(
      ok(createFakeWhatsAppContact({ id: 'ct1', avatarUrl: 'x' })),
    )
  }

  const sync = () => WhatsAppContactService.syncAvatar('u1', 'ws1', 'ct1')

  it('should return FORBIDDEN for a non-member', async () => {
    asNonMember()

    expectErr(await sync(), 'FORBIDDEN')
  })

  it('should propagate a contact lookup failure', async () => {
    arrangeSync()
    mockedContactRepo.findById.mockResolvedValue(err(DB_ERROR))

    expectErr(await sync(), 'DATABASE_ERROR')
  })

  it('should propagate a connection listing failure', async () => {
    arrangeSync()
    mockedConnectionRepo.listByWorkspace.mockResolvedValue(err(DB_ERROR))

    expectErr(await sync(), 'DATABASE_ERROR')
  })

  it('should pass the decrypted client token to Z-API', async () => {
    arrangeSync()

    expectOk(await sync())

    expect(mockedGetProfilePicture).toHaveBeenCalledWith(
      { instanceId: 'instance-1', token: 'token', clientToken: 'client' },
      '5511',
    )
  })

  it.each([
    [new Error('Z-API 401'), 'Z-API 401'],
    ['boom', 'Falha ao buscar foto'],
  ])(
    'should map a provider exception (%s) to WHATSAPP_PROVIDER_ERROR',
    async (thrown, message) => {
      arrangeSync()
      mockedGetProfilePicture.mockRejectedValue(thrown)

      const error = expectErr(await sync(), 'WHATSAPP_PROVIDER_ERROR')
      expect(error.message).toBe(message)
      expect(mockedContactRepo.update).not.toHaveBeenCalled()
    },
  )

  it('should propagate the avatar update failure', async () => {
    arrangeSync()
    mockedContactRepo.update.mockResolvedValue(err(DB_ERROR))

    expectErr(await sync(), 'DATABASE_ERROR')
  })
})

describe('WhatsAppContactService.update()', () => {
  const update = () =>
    WhatsAppContactService.update('u1', 'ws1', 'ct1', { name: 'Ana' })

  it('should update the contact and audit the changed fields', async () => {
    asAdmin()
    mockedContactRepo.findById.mockResolvedValue(ok(contact()))
    mockedContactRepo.update.mockResolvedValue(
      ok(createFakeWhatsAppContact({ id: 'ct1', name: 'Ana' })),
    )

    expect(expectOk(await update()).name).toBe('Ana')
    expect(mockedContactRepo.update).toHaveBeenCalledWith('ct1', {
      name: 'Ana',
    })
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update',
        targetId: 'ct1',
        meta: { fields: ['name'] },
      }),
    )
  })

  it('should return FORBIDDEN for a non-member', async () => {
    asNonMember()

    expectErr(await update(), 'FORBIDDEN')
  })

  it('should propagate a lookup failure', async () => {
    asAdmin()
    mockedContactRepo.findById.mockResolvedValue(err(DB_ERROR))

    expectErr(await update(), 'DATABASE_ERROR')
  })

  it('should return WHATSAPP_CONTACT_NOT_FOUND when missing', async () => {
    asAdmin()
    mockedContactRepo.findById.mockResolvedValue(ok(null))

    expectErr(await update(), 'WHATSAPP_CONTACT_NOT_FOUND')
    expect(mockedContactRepo.update).not.toHaveBeenCalled()
  })

  it('should propagate an update failure', async () => {
    asAdmin()
    mockedContactRepo.findById.mockResolvedValue(ok(contact()))
    mockedContactRepo.update.mockResolvedValue(err(DB_ERROR))

    expectErr(await update(), 'DATABASE_ERROR')
  })
})

describe('WhatsAppContactService.setBroadcastOptOut() failures', () => {
  it('should propagate a lookup failure', async () => {
    asAdmin()
    mockedContactRepo.findById.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppContactService.setBroadcastOptOut('u1', 'ws1', 'ct1', {
        optedOut: true,
      }),
      'DATABASE_ERROR',
    )
  })

  it('should propagate the opt-out write failure', async () => {
    asAdmin()
    mockedContactRepo.findById.mockResolvedValue(ok(contact()))
    mockedContactRepo.setBroadcastOptOut.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppContactService.setBroadcastOptOut('u1', 'ws1', 'ct1', {
        optedOut: true,
      }),
      'DATABASE_ERROR',
    )
    expect(auditMutation).not.toHaveBeenCalled()
  })

  it('should record a null previous opt-out date on a requested opt-in', async () => {
    asAdmin()
    mockedContactRepo.findById.mockResolvedValue(
      ok(
        createFakeWhatsAppContact({
          id: 'ct1',
          broadcastOptedOutAt: null,
          broadcastOptOutSource: null,
        }),
      ),
    )
    mockedContactRepo.setBroadcastOptOut.mockResolvedValue(ok(contact()))

    expectOk(
      await WhatsAppContactService.setBroadcastOptOut('u1', 'ws1', 'ct1', {
        optedOut: false,
        contactRequested: true,
      }),
    )

    expect(mockedContactRepo.setBroadcastOptOut).toHaveBeenCalledWith(
      'ct1',
      null,
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'opt_in',
        meta: expect.objectContaining({
          contactRequested: true,
          previousOptOutAt: null,
          previousOptOutSource: null,
        }),
      }),
    )
  })
})

describe('WhatsAppContactService.remove() failures', () => {
  it('should return FORBIDDEN for a non-member', async () => {
    asNonMember()

    expectErr(
      await WhatsAppContactService.remove('u1', 'ws1', 'ct1'),
      'FORBIDDEN',
    )
  })

  it('should propagate a lookup failure', async () => {
    asAdmin()
    mockedContactRepo.findById.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppContactService.remove('u1', 'ws1', 'ct1'),
      'DATABASE_ERROR',
    )
    expect(mockedContactRepo.delete).not.toHaveBeenCalled()
  })
})
