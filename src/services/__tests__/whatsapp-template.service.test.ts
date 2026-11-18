import { describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppTemplate } from '@/src/__tests__/factories/whatsapp-template.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-template.repository')
vi.mock('@/src/lib/crypto', () => ({
  decryptConnectionSecret: vi.fn(async (envelope: string) =>
    envelope.replace(/^enc:/, ''),
  ),
}))
vi.mock('@/src/lib/whatsapp/meta-number-quality', () => ({
  metaNumberQualityOf: vi.fn(async () => 'UNKNOWN'),
}))
vi.mock('@/src/lib/whatsapp/meta-templates', () => ({
  fetchMetaTemplates: vi.fn(async () => [
    {
      name: 'boas_vindas',
      language: 'pt_BR',
      category: 'MARKETING',
      status: 'APPROVED',
      components: [],
    },
  ]),
  createMetaTemplate: vi.fn(async () => ({
    name: 'confirmacao_exame',
    language: 'pt_BR',
    category: 'UTILITY',
    status: 'PENDING',
    components: [],
  })),
}))

import {
  createMetaTemplate,
  fetchMetaTemplates,
} from '@/src/lib/whatsapp/meta-templates'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppTemplateRepository } from '@/src/repositories/whatsapp-template.repository'
import { WhatsAppTemplateService } from '../whatsapp-template.service'

const mockedMembershipRepo = vi.mocked(MembershipRepository)
const mockedConnectionRepo = vi.mocked(WhatsAppConnectionRepository)
const mockedTemplateRepo = vi.mocked(WhatsAppTemplateRepository)
const mockedFetchMetaTemplates = vi.mocked(fetchMetaTemplates)
const mockedCreateMetaTemplate = vi.mocked(createMetaTemplate)

describe('WhatsAppTemplateService', () => {
  describe('sync()', () => {
    it('should sync templates for a META connection', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'ADMIN' })),
      )
      const connection = createFakeWhatsAppConnection({
        id: 'conn1',
        provider: 'META',
        metaWabaId: 'waba-1',
        encryptedMetaAccessToken: 'enc:access-token',
      })
      mockedConnectionRepo.findById.mockResolvedValue(ok(connection))
      const synced = createFakeWhatsAppTemplate({ name: 'boas_vindas' })
      mockedTemplateRepo.upsertSynced.mockResolvedValue(ok(synced))
      mockedTemplateRepo.listByWorkspace.mockResolvedValue(ok([]))

      const result = await WhatsAppTemplateService.sync('u1', 'ws1', 'conn1')

      const dtos = expectOk(result)
      expect(dtos).toHaveLength(1)
      expect(mockedFetchMetaTemplates).toHaveBeenCalledWith({
        wabaId: 'waba-1',
        accessToken: 'access-token',
      })
    })

    it('should reject syncing a Z-API connection', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'ADMIN' })),
      )
      const connection = createFakeWhatsAppConnection({
        id: 'conn1',
        provider: 'ZAPI',
      })
      mockedConnectionRepo.findById.mockResolvedValue(ok(connection))

      const result = await WhatsAppTemplateService.sync('u1', 'ws1', 'conn1')

      expectErr(result, 'BAD_REQUEST')
      expect(mockedFetchMetaTemplates).not.toHaveBeenCalled()
    })

    it('should return WHATSAPP_CONNECTION_NOT_FOUND for an unknown connection', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'ADMIN' })),
      )
      mockedConnectionRepo.findById.mockResolvedValue(ok(null))

      const result = await WhatsAppTemplateService.sync('u1', 'ws1', 'conn1')

      expectErr(result, 'WHATSAPP_CONNECTION_NOT_FOUND')
    })
  })

  describe('create()', () => {
    const input = {
      connectionId: 'conn1',
      name: 'confirmacao_exame',
      language: 'pt_BR',
      category: 'UTILITY' as const,
      body: 'Olá {{1}}, confirmando seu exame de {{2}}.',
    }

    it('should forbid a MEMBER from creating a template (admin-only)', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )

      expectErr(
        await WhatsAppTemplateService.create('u1', 'ws1', input),
        'FORBIDDEN',
      )
      expect(mockedCreateMetaTemplate).not.toHaveBeenCalled()
    })

    it('should submit to Meta and persist the template as PENDING', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'ADMIN' })),
      )
      const connection = createFakeWhatsAppConnection({
        id: 'conn1',
        provider: 'META',
        metaWabaId: 'waba-1',
        encryptedMetaAccessToken: 'enc:access-token',
      })
      mockedConnectionRepo.findById.mockResolvedValue(ok(connection))
      const saved = createFakeWhatsAppTemplate({
        name: 'confirmacao_exame',
        status: 'PENDING',
      })
      mockedTemplateRepo.upsertSynced.mockResolvedValue(ok(saved))

      const result = await WhatsAppTemplateService.create('u1', 'ws1', input)

      const dto = expectOk(result)
      expect(dto.status).toBe('PENDING')
      expect(mockedCreateMetaTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          wabaId: 'waba-1',
          accessToken: 'access-token',
          name: 'confirmacao_exame',
        }),
      )
      expect(mockedTemplateRepo.upsertSynced).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'ws1',
          connectionId: 'conn1',
          name: 'confirmacao_exame',
          status: 'PENDING',
        }),
      )
    })

    it('should attach a body example (required by Meta, or INVALID_FORMAT)', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'ADMIN' })),
      )
      const connection = createFakeWhatsAppConnection({
        id: 'conn1',
        provider: 'META',
        metaWabaId: 'waba-1',
        encryptedMetaAccessToken: 'enc:access-token',
      })
      mockedConnectionRepo.findById.mockResolvedValue(ok(connection))
      mockedTemplateRepo.upsertSynced.mockResolvedValue(
        ok(createFakeWhatsAppTemplate()),
      )

      await WhatsAppTemplateService.create('u1', 'ws1', {
        ...input,
        bodyExample: ['Maria', 'Hemograma completo'],
      })

      expect(mockedCreateMetaTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          components: expect.arrayContaining([
            expect.objectContaining({
              type: 'BODY',
              example: { body_text: [['Maria', 'Hemograma completo']] },
            }),
          ]),
        }),
      )
    })

    it('should fall back to a placeholder example when none is provided', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'ADMIN' })),
      )
      const connection = createFakeWhatsAppConnection({
        id: 'conn1',
        provider: 'META',
        metaWabaId: 'waba-1',
        encryptedMetaAccessToken: 'enc:access-token',
      })
      mockedConnectionRepo.findById.mockResolvedValue(ok(connection))
      mockedTemplateRepo.upsertSynced.mockResolvedValue(
        ok(createFakeWhatsAppTemplate()),
      )

      await WhatsAppTemplateService.create('u1', 'ws1', input)

      expect(mockedCreateMetaTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          components: expect.arrayContaining([
            expect.objectContaining({
              type: 'BODY',
              example: { body_text: [['exemplo1', 'exemplo2']] },
            }),
          ]),
        }),
      )
    })

    it('should not attach an example when the body has no variables', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'ADMIN' })),
      )
      const connection = createFakeWhatsAppConnection({
        id: 'conn1',
        provider: 'META',
        metaWabaId: 'waba-1',
        encryptedMetaAccessToken: 'enc:access-token',
      })
      mockedConnectionRepo.findById.mockResolvedValue(ok(connection))
      mockedTemplateRepo.upsertSynced.mockResolvedValue(
        ok(createFakeWhatsAppTemplate()),
      )

      await WhatsAppTemplateService.create('u1', 'ws1', {
        ...input,
        body: 'Mensagem sem variáveis.',
      })

      const call = mockedCreateMetaTemplate.mock.calls.at(-1)?.[0]
      const bodyComponent = (
        call?.components as Array<{ type: string; example?: unknown }>
      )?.find((c) => c.type === 'BODY')
      expect(bodyComponent?.example).toBeUndefined()
    })

    it('should reject creating on a Z-API connection', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'ADMIN' })),
      )
      const connection = createFakeWhatsAppConnection({
        id: 'conn1',
        provider: 'ZAPI',
      })
      mockedConnectionRepo.findById.mockResolvedValue(ok(connection))

      const result = await WhatsAppTemplateService.create('u1', 'ws1', input)

      expectErr(result, 'BAD_REQUEST')
      expect(mockedCreateMetaTemplate).not.toHaveBeenCalled()
    })

    it('should surface Meta API errors as BAD_REQUEST', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'ADMIN' })),
      )
      const connection = createFakeWhatsAppConnection({
        id: 'conn1',
        provider: 'META',
        metaWabaId: 'waba-1',
        encryptedMetaAccessToken: 'enc:access-token',
      })
      mockedConnectionRepo.findById.mockResolvedValue(ok(connection))
      mockedCreateMetaTemplate.mockRejectedValueOnce(
        new Error('Nome de template já existe'),
      )

      const result = await WhatsAppTemplateService.create('u1', 'ws1', input)

      const error = expectErr(result, 'BAD_REQUEST')
      expect(error.message).toContain('já existe')
      expect(mockedTemplateRepo.upsertSynced).not.toHaveBeenCalled()
    })
  })
})
