import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppBroadcastListWithRecipients } from '@/src/__tests__/factories/whatsapp-broadcast.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppContact } from '@/src/__tests__/factories/whatsapp-contact.factory'
import { createFakeWhatsAppTemplate } from '@/src/__tests__/factories/whatsapp-template.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { featureNotEnabled } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/services/feature-flag.service')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-template.repository')
vi.mock('@/src/repositories/whatsapp-contact.repository')
vi.mock('@/src/repositories/whatsapp-broadcast.repository')
vi.mock('../whatsapp-contact-validation.service')

import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppBroadcastRepository } from '@/src/repositories/whatsapp-broadcast.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppTemplateRepository } from '@/src/repositories/whatsapp-template.repository'
import { assertFeature } from '../feature-flag.service'
import { WhatsAppBroadcastImportService } from '../whatsapp-broadcast-import.service'
import { WhatsAppContactValidationService } from '../whatsapp-contact-validation.service'

const mockedMembershipRepo = vi.mocked(MembershipRepository)
const mockedConnectionRepo = vi.mocked(WhatsAppConnectionRepository)
const mockedTemplateRepo = vi.mocked(WhatsAppTemplateRepository)
const mockedContactRepo = vi.mocked(WhatsAppContactRepository)
const mockedBroadcastRepo = vi.mocked(WhatsAppBroadcastRepository)
const mockedAssertFeature = vi.mocked(assertFeature)
const mockedValidation = vi.mocked(WhatsAppContactValidationService)

beforeEach(() => {
  mockedAssertFeature.mockResolvedValue(ok(true))
})

const validCsv = [
  'telefone,nome,data_referencia,var_1',
  '11987654321,Maria,2026-08-15T09:00:00.000Z,Maria',
].join('\n')

function mockHappyPathDeps() {
  mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'ADMIN' })),
  )
  mockedConnectionRepo.findById.mockResolvedValue(
    ok(createFakeWhatsAppConnection({ id: 'conn1' })),
  )
  mockedTemplateRepo.findById.mockResolvedValue(
    ok(
      createFakeWhatsAppTemplate({
        id: 'tmpl1',
        status: 'APPROVED',
        components: [{ type: 'BODY', text: 'Olá {{1}}' }],
      }),
    ),
  )
  mockedContactRepo.upsertByWaId.mockResolvedValue(
    ok(createFakeWhatsAppContact({ id: 'contact1' })),
  )
  mockedBroadcastRepo.createScheduled.mockResolvedValue(
    ok(createFakeWhatsAppBroadcastListWithRecipients({ id: 'list1' }, 1)),
  )
}

describe('WhatsAppBroadcastImportService.import()', () => {
  it('should create a scheduled broadcast from a valid csv', async () => {
    mockHappyPathDeps()

    const result = await WhatsAppBroadcastImportService.import('u1', 'ws1', {
      name: 'Lembretes',
      connectionId: 'conn1',
      templateId: 'tmpl1',
      sendOffsetHours: 24,
      csv: validCsv,
    })

    const dto = expectOk(result)
    expect(dto.createdCount).toBe(1)
    expect(dto.rejectedRows).toEqual([])
    expect(dto.broadcastList?.id).toBe('list1')
    expect(mockedBroadcastRepo.createScheduled).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'conn1', templateId: 'tmpl1' }),
      [
        expect.objectContaining({
          contactId: 'contact1',
          variableValues: { body: { '1': 'Maria' } },
        }),
      ],
    )
  })

  it('should reject rows whose contact opted out of broadcasts', async () => {
    mockHappyPathDeps()
    mockedContactRepo.upsertByWaId.mockResolvedValue(
      ok(
        createFakeWhatsAppContact({
          id: 'contact1',
          broadcastOptedOutAt: new Date(),
          broadcastOptOutSource: 'KEYWORD',
        }),
      ),
    )

    const dto = expectOk(
      await WhatsAppBroadcastImportService.import('u1', 'ws1', {
        name: 'Lembretes',
        connectionId: 'conn1',
        templateId: 'tmpl1',
        sendOffsetHours: 24,
        csv: validCsv,
      }),
    )

    expect(dto.createdCount).toBe(0)
    expect(dto.broadcastList).toBeNull()
    expect(dto.rejectedRows).toEqual([
      { rowNumber: 1, reason: expect.stringMatching(/descadastr/i) },
    ])
    expect(mockedBroadcastRepo.createScheduled).not.toHaveBeenCalled()
  })

  it('should return WHATSAPP_CONNECTION_NOT_FOUND when the connection does not exist', async () => {
    mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership({ role: 'ADMIN' })),
    )
    mockedConnectionRepo.findById.mockResolvedValue(ok(null))

    const result = await WhatsAppBroadcastImportService.import('u1', 'ws1', {
      name: 'Lembretes',
      connectionId: 'conn1',
      templateId: 'tmpl1',
      sendOffsetHours: 24,
      csv: validCsv,
    })

    expectErr(result, 'WHATSAPP_CONNECTION_NOT_FOUND')
  })

  it('should return WHATSAPP_TEMPLATE_NOT_FOUND when the template does not exist', async () => {
    mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership({ role: 'ADMIN' })),
    )
    mockedConnectionRepo.findById.mockResolvedValue(
      ok(createFakeWhatsAppConnection({ id: 'conn1' })),
    )
    mockedTemplateRepo.findById.mockResolvedValue(ok(null))

    const result = await WhatsAppBroadcastImportService.import('u1', 'ws1', {
      name: 'Lembretes',
      connectionId: 'conn1',
      templateId: 'tmpl1',
      sendOffsetHours: 24,
      csv: validCsv,
    })

    expectErr(result, 'WHATSAPP_TEMPLATE_NOT_FOUND')
  })

  it('should return WHATSAPP_TEMPLATE_NOT_APPROVED for a non-approved template', async () => {
    mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership({ role: 'ADMIN' })),
    )
    mockedConnectionRepo.findById.mockResolvedValue(
      ok(createFakeWhatsAppConnection({ id: 'conn1' })),
    )
    mockedTemplateRepo.findById.mockResolvedValue(
      ok(createFakeWhatsAppTemplate({ id: 'tmpl1', status: 'PENDING' })),
    )

    const result = await WhatsAppBroadcastImportService.import('u1', 'ws1', {
      name: 'Lembretes',
      connectionId: 'conn1',
      templateId: 'tmpl1',
      sendOffsetHours: 24,
      csv: validCsv,
    })

    expectErr(result, 'WHATSAPP_TEMPLATE_NOT_APPROVED')
  })

  it('should return BAD_REQUEST when the csv is malformed', async () => {
    mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership({ role: 'ADMIN' })),
    )
    mockedConnectionRepo.findById.mockResolvedValue(
      ok(createFakeWhatsAppConnection({ id: 'conn1' })),
    )
    mockedTemplateRepo.findById.mockResolvedValue(
      ok(createFakeWhatsAppTemplate({ id: 'tmpl1', status: 'APPROVED' })),
    )

    const result = await WhatsAppBroadcastImportService.import('u1', 'ws1', {
      name: 'Lembretes',
      connectionId: 'conn1',
      templateId: 'tmpl1',
      sendOffsetHours: 24,
      csv: 'nome,var_1\nMaria,x',
    })

    expectErr(result, 'BAD_REQUEST')
  })

  it('should return a partial result (no broadcast created) when every row is rejected', async () => {
    mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership({ role: 'ADMIN' })),
    )
    mockedConnectionRepo.findById.mockResolvedValue(
      ok(createFakeWhatsAppConnection({ id: 'conn1' })),
    )
    mockedTemplateRepo.findById.mockResolvedValue(
      ok(
        createFakeWhatsAppTemplate({
          id: 'tmpl1',
          status: 'APPROVED',
          components: [{ type: 'BODY', text: 'Olá {{1}}' }],
        }),
      ),
    )

    const invalidCsv = [
      'telefone,data_referencia,var_1',
      'abc,2026-08-15,Maria',
    ].join('\n')

    const result = await WhatsAppBroadcastImportService.import('u1', 'ws1', {
      name: 'Lembretes',
      connectionId: 'conn1',
      templateId: 'tmpl1',
      sendOffsetHours: 24,
      csv: invalidCsv,
    })

    const dto = expectOk(result)
    expect(dto.broadcastList).toBeNull()
    expect(dto.createdCount).toBe(0)
    expect(dto.rejectedRows).toHaveLength(1)
    expect(mockedBroadcastRepo.createScheduled).not.toHaveBeenCalled()
  })

  describe('feature flag communication.broadcasts', () => {
    it('should block the import when broadcasts are off for the workspace', async () => {
      mockHappyPathDeps()
      mockedAssertFeature.mockResolvedValue(err(featureNotEnabled()))

      expectErr(
        await WhatsAppBroadcastImportService.import('u1', 'ws1', {
          name: 'Lembretes',
          connectionId: 'conn1',
          templateId: 'tmpl1',
          sendOffsetHours: 24,
          csv: validCsv,
        }),
        'FEATURE_NOT_ENABLED',
      )
      expect(mockedBroadcastRepo.createScheduled).not.toHaveBeenCalled()
    })
  })
})

describe('WhatsAppBroadcastImportService.import() failure paths', () => {
  const DB_ERROR = { code: 'DATABASE_ERROR' as const, message: 'db down' }
  const input = {
    name: 'Lembretes',
    connectionId: 'conn1',
    templateId: 'tmpl1',
    sendOffsetHours: 24,
    csv: validCsv,
  }

  it('should return FORBIDDEN for a non-member', async () => {
    mockHappyPathDeps()
    mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))

    expectErr(
      await WhatsAppBroadcastImportService.import('u1', 'ws1', input),
      'FORBIDDEN',
    )
  })

  it('should propagate a connection lookup failure', async () => {
    mockHappyPathDeps()
    mockedConnectionRepo.findById.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppBroadcastImportService.import('u1', 'ws1', input),
      'DATABASE_ERROR',
    )
  })

  it('should propagate a template lookup failure', async () => {
    mockHappyPathDeps()
    mockedTemplateRepo.findById.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppBroadcastImportService.import('u1', 'ws1', input),
      'DATABASE_ERROR',
    )
  })

  it('should propagate a contact upsert failure', async () => {
    mockHappyPathDeps()
    mockedContactRepo.upsertByWaId.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppBroadcastImportService.import('u1', 'ws1', input),
      'DATABASE_ERROR',
    )
    expect(mockedBroadcastRepo.createScheduled).not.toHaveBeenCalled()
  })

  it('should list rejected rows in csv order when invalid and opted-out rows mix', async () => {
    mockHappyPathDeps()
    mockedContactRepo.upsertByWaId
      .mockResolvedValueOnce(
        ok(
          createFakeWhatsAppContact({
            id: 'opted',
            broadcastOptedOutAt: new Date(),
          }),
        ),
      )
      .mockResolvedValueOnce(ok(createFakeWhatsAppContact({ id: 'contact3' })))
    const csv = [
      'telefone,nome,data_referencia,var_1',
      '11987654321,Maria,2026-08-15T09:00:00.000Z,Maria',
      'abc,Joao,2026-08-15T09:00:00.000Z,Joao',
      '11912345678,Ana,2026-08-15T09:00:00.000Z,Ana',
    ].join('\n')

    const dto = expectOk(
      await WhatsAppBroadcastImportService.import('u1', 'ws1', {
        ...input,
        csv,
      }),
    )

    expect(dto.createdCount).toBe(1)
    expect(dto.rejectedRows.map((r) => r.rowNumber)).toEqual([1, 2])
    expect(mockedBroadcastRepo.createScheduled).toHaveBeenCalledWith(
      expect.anything(),
      [expect.objectContaining({ contactId: 'contact3' })],
    )
  })

  it('should propagate a failure creating the scheduled broadcast', async () => {
    mockHappyPathDeps()
    mockedBroadcastRepo.createScheduled.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppBroadcastImportService.import('u1', 'ws1', input),
      'DATABASE_ERROR',
    )
  })

  describe('"validar se tem WhatsApp" step', () => {
    const base = {
      name: 'Lembretes',
      connectionId: 'conn1',
      templateId: 'tmpl1',
      sendOffsetHours: 24,
      csv: validCsv,
    }

    it('does not validate unless asked', async () => {
      mockHappyPathDeps()
      const dto = expectOk(
        await WhatsAppBroadcastImportService.import('u1', 'ws1', base),
      )
      expect(mockedValidation.startInternal).not.toHaveBeenCalled()
      expect(dto.validation).toBeUndefined()
    })

    it('validates the imported recipients and stores the skip choice', async () => {
      mockHappyPathDeps()
      mockedValidation.startInternal.mockResolvedValue(
        ok({ id: 'run1', status: 'DONE' } as never),
      )

      const dto = expectOk(
        await WhatsAppBroadcastImportService.import('u1', 'ws1', {
          ...base,
          validateWhatsapp: true,
          skipNoWhatsapp: true,
        }),
      )

      expect(mockedBroadcastRepo.createScheduled).toHaveBeenCalledWith(
        expect.objectContaining({ skipNoWhatsapp: true }),
        expect.any(Array),
      )
      expect(mockedValidation.startInternal).toHaveBeenCalledWith('u1', 'ws1', {
        scope: 'BROADCAST',
        scopeId: 'list1',
        contactIds: ['contact1'],
      })
      expect(dto.validation).toMatchObject({ id: 'run1' })
      expect(dto.validationUnavailable).toBeNull()
    })

    it('still imports when the check is unavailable (no Z-API)', async () => {
      mockHappyPathDeps()
      mockedValidation.startInternal.mockResolvedValue(
        err({
          code: 'WHATSAPP_VALIDATION_UNAVAILABLE',
          message: 'Conecte uma instância Z-API',
        } as never),
      )

      const dto = expectOk(
        await WhatsAppBroadcastImportService.import('u1', 'ws1', {
          ...base,
          validateWhatsapp: true,
        }),
      )

      expect(dto.createdCount).toBe(1)
      expect(dto.validation).toBeNull()
      expect(dto.validationUnavailable).toBe('Conecte uma instância Z-API')
    })
  })
})
