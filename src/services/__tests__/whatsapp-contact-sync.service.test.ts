import { describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppContact } from '@/src/__tests__/factories/whatsapp-contact.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-contact.repository')
vi.mock('@/src/lib/crypto', () => ({
  decryptConnectionSecret: vi.fn(async (envelope: string) =>
    envelope.replace(/^enc:/, ''),
  ),
}))
vi.mock('@/src/lib/search/index-hooks', () => ({
  indexSearchDocument: vi.fn(),
}))
vi.mock('@/src/lib/whatsapp/zapi-client', () => ({
  listZapiPhonebook: vi.fn(),
}))

import { listZapiPhonebook } from '@/src/lib/whatsapp/zapi-client'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppContactSyncService } from '../whatsapp-contact-sync.service'

const membershipRepo = vi.mocked(MembershipRepository)
const connectionRepo = vi.mocked(WhatsAppConnectionRepository)
const contactRepo = vi.mocked(WhatsAppContactRepository)
const phonebook = vi.mocked(listZapiPhonebook)

const zapiConnection = createFakeWhatsAppConnection({
  provider: 'ZAPI',
  zapiInstanceId: 'instance-1',
  encryptedZapiToken: 'enc:token',
  encryptedZapiClientToken: 'enc:client',
})

function asMember() {
  membershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'MEMBER' })),
  )
}

describe('WhatsAppContactSyncService.syncPhonebook()', () => {
  it('creates new contacts, keeps known ones and skips groups and duplicates', async () => {
    asMember()
    connectionRepo.listByWorkspace.mockResolvedValue(
      ok([createFakeWhatsAppConnection({ provider: 'META' }), zapiConnection]),
    )
    phonebook.mockResolvedValue([
      { name: 'Maria', phone: '5511999998888' },
      { name: 'João', phone: '5511977776666' },
      { name: 'João de novo', phone: '5511977776666' },
      { name: 'Grupo', phone: '120363000000000000-group' },
      { name: 'Sem número' },
    ])
    contactRepo.findManyByWaIds.mockResolvedValue(
      ok([createFakeWhatsAppContact({ waId: '5511999998888' })]),
    )
    contactRepo.upsertByWaId.mockResolvedValue(
      ok(createFakeWhatsAppContact({ id: 'c1' })),
    )

    const result = await WhatsAppContactSyncService.syncPhonebook('u1', 'ws1')

    expect(expectOk(result)).toEqual({ created: 1, updated: 1, skipped: 3 })
    expect(phonebook).toHaveBeenCalledWith({
      instanceId: 'instance-1',
      token: 'token',
      clientToken: 'client',
    })
    // The known contact keeps its name; the new one gets the phone book's.
    expect(contactRepo.upsertByWaId).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      waId: '5511999998888',
      name: undefined,
    })
    expect(contactRepo.upsertByWaId).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      waId: '5511977776666',
      name: 'João',
    })
  })

  it('refuses with a Meta-specific message when only Meta is connected', async () => {
    asMember()
    connectionRepo.listByWorkspace.mockResolvedValue(
      ok([createFakeWhatsAppConnection({ provider: 'META' })]),
    )

    const result = await WhatsAppContactSyncService.syncPhonebook('u1', 'ws1')

    const error = expectErr(result, 'WHATSAPP_CONTACT_SYNC_UNAVAILABLE')
    expect(error.message).toContain('Meta')
    expect(phonebook).not.toHaveBeenCalled()
  })

  it('refuses when there is no connection at all', async () => {
    asMember()
    connectionRepo.listByWorkspace.mockResolvedValue(ok([]))

    const result = await WhatsAppContactSyncService.syncPhonebook('u1', 'ws1')

    expectErr(result, 'WHATSAPP_CONTACT_SYNC_UNAVAILABLE')
  })

  it('returns a provider error when Z-API fails', async () => {
    asMember()
    connectionRepo.listByWorkspace.mockResolvedValue(ok([zapiConnection]))
    phonebook.mockRejectedValue(new Error('Client-Token inválido'))

    const result = await WhatsAppContactSyncService.syncPhonebook('u1', 'ws1')

    expectErr(result, 'WHATSAPP_PROVIDER_ERROR')
  })
})
