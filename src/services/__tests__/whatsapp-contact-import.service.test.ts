import { describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppContact } from '@/src/__tests__/factories/whatsapp-contact.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-contact.repository')
vi.mock('../whatsapp-contact-validation.service')
vi.mock('@/src/lib/search/index-hooks', () => ({
  indexSearchDocument: vi.fn(),
}))

import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppContactImportService } from '../whatsapp-contact-import.service'
import { WhatsAppContactValidationService } from '../whatsapp-contact-validation.service'

const membershipRepo = vi.mocked(MembershipRepository)
const contactRepo = vi.mocked(WhatsAppContactRepository)
const validation = vi.mocked(WhatsAppContactValidationService)

function asMember() {
  membershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'MEMBER' })),
  )
}

describe('WhatsAppContactImportService.import()', () => {
  it('creates new contacts, updates existing ones and reports rejected rows', async () => {
    asMember()
    const existing = createFakeWhatsAppContact({
      id: 'c1',
      workspaceId: 'ws1',
      waId: '5511999998888',
    })
    contactRepo.findManyByWaIds.mockResolvedValue(ok([existing]))
    contactRepo.update.mockResolvedValue(ok(existing))
    contactRepo.create.mockResolvedValue(
      ok(createFakeWhatsAppContact({ id: 'c2' })),
    )

    const result = await WhatsAppContactImportService.import('u1', 'ws1', {
      csv: 'Nome;Telefone;Descrição\nMaria;5511999998888;VIP\nJoão;5511977776666;\nRuim;12',
    })

    expect(expectOk(result)).toMatchObject({
      created: 1,
      updated: 1,
      skipped: 1,
      rejected: [{ line: 4 }],
    })
    expect(contactRepo.update).toHaveBeenCalledWith('c1', {
      name: 'Maria',
      description: 'VIP',
    })
    expect(contactRepo.create).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      waId: '5511977776666',
      name: 'João',
      description: undefined,
    })
  })

  it('returns FORBIDDEN for a non-member', async () => {
    membershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
    const result = await WhatsAppContactImportService.import('u1', 'ws1', {
      csv: 'Telefone\n5511999998888',
    })
    expectErr(result, 'FORBIDDEN')
  })

  it('returns BAD_REQUEST for a file-level problem', async () => {
    asMember()
    const result = await WhatsAppContactImportService.import('u1', 'ws1', {
      csv: 'Nome\nAna',
    })
    expectErr(result, 'BAD_REQUEST')
  })

  it('propagates a lookup failure', async () => {
    asMember()
    contactRepo.findManyByWaIds.mockResolvedValue(err(databaseError('x')))
    const result = await WhatsAppContactImportService.import('u1', 'ws1', {
      csv: 'Telefone\n5511999998888',
    })
    expectErr(result, 'DATABASE_ERROR')
  })

  it('reports rows that fail to save instead of aborting', async () => {
    asMember()
    contactRepo.findManyByWaIds.mockResolvedValue(ok([]))
    contactRepo.create.mockResolvedValue(err(databaseError('x')))
    const result = await WhatsAppContactImportService.import('u1', 'ws1', {
      csv: 'Telefone\n5511999998888',
    })
    expect(expectOk(result)).toMatchObject({
      created: 0,
      skipped: 1,
      rejected: [{ line: 2, message: 'Falha ao salvar o contato.' }],
    })
  })

  describe('"validar se tem WhatsApp" step', () => {
    function arrange() {
      asMember()
      contactRepo.findManyByWaIds.mockResolvedValue(ok([]))
      contactRepo.create.mockResolvedValue(
        ok(createFakeWhatsAppContact({ id: 'c9' })),
      )
    }

    it('does not validate unless asked', async () => {
      arrange()
      const result = await WhatsAppContactImportService.import('u1', 'ws1', {
        csv: 'Telefone\n5511999998888',
      })
      expect(validation.startInternal).not.toHaveBeenCalled()
      expect(expectOk(result).validation).toBeUndefined()
    })

    it('validates the saved contacts when asked', async () => {
      arrange()
      validation.startInternal.mockResolvedValue(
        ok({ id: 'run1', status: 'QUEUED' } as never),
      )

      const result = await WhatsAppContactImportService.import('u1', 'ws1', {
        csv: 'Telefone\n5511999998888',
        validateWhatsapp: true,
      })

      expect(validation.startInternal).toHaveBeenCalledWith('u1', 'ws1', {
        scope: 'IMPORT',
        scopeId: null,
        contactIds: ['c9'],
      })
      expect(expectOk(result)).toMatchObject({
        created: 1,
        validation: { id: 'run1' },
        validationUnavailable: null,
      })
    })

    it('reports why the check did not run without undoing the import', async () => {
      arrange()
      validation.startInternal.mockResolvedValue(
        err({
          code: 'WHATSAPP_VALIDATION_UNAVAILABLE',
          message: 'Sem Z-API',
        } as never),
      )

      const result = await WhatsAppContactImportService.import('u1', 'ws1', {
        csv: 'Telefone\n5511999998888',
        validateWhatsapp: true,
      })

      expect(expectOk(result)).toMatchObject({
        created: 1,
        validation: null,
        validationUnavailable: 'Sem Z-API',
      })
    })
  })
})
