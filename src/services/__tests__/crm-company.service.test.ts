import type { CrmCompany, CrmCustomFieldDefinition, Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeCrmCompany } from '@/src/__tests__/factories/crm-company.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, notFound } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import { toCrmCompanyDTO } from '@/src/mappers/crm-company.mapper'

vi.mock('@/lib/axiom/audit')
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-company.repository')
vi.mock('@/src/repositories/crm-activity.repository')
vi.mock('@/src/repositories/crm-custom-field.repository')
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../crm-cnpj-enrichment.service', () => ({
  enrichCompany: vi.fn(),
}))
vi.mock('../crm-workflow-dispatcher', () => ({
  dispatchCrmWorkflowRecordEvent: vi.fn(async () => undefined),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { CrmActivityRepository } from '@/src/repositories/crm-activity.repository'
import { CrmCompanyRepository } from '@/src/repositories/crm-company.repository'
import {
  CrmCustomFieldDefinitionRepository,
  CrmCustomFieldValueRepository,
} from '@/src/repositories/crm-custom-field.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { enrichCompany } from '../crm-cnpj-enrichment.service'
import { CrmCompanyService } from '../crm-company.service'
import { dispatchCrmWorkflowRecordEvent } from '../crm-workflow-dispatcher'

const mockedMembershipRepo = vi.mocked(MembershipRepository)
const mockedCompanyRepo = vi.mocked(CrmCompanyRepository)
const mockedCustomFieldValueRepo = vi.mocked(CrmCustomFieldValueRepository)
const mockedCustomFieldDefRepo = vi.mocked(CrmCustomFieldDefinitionRepository)
const mockedActivityRepo = vi.mocked(CrmActivityRepository)
const mockedDispatch = vi.mocked(dispatchCrmWorkflowRecordEvent)
const mockedAudit = vi.mocked(auditMutation)

function asRole(role: Role) {
  mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

function textDefinition(
  overrides?: Partial<CrmCustomFieldDefinition>,
): CrmCustomFieldDefinition {
  return {
    id: 'def1',
    workspaceId: 'ws1',
    entity: 'COMPANY',
    key: 'segment',
    label: 'Segmento',
    type: 'TEXT',
    options: [],
    required: false,
    position: 0,
    createdById: 'u1',
    updatedById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  }
}

const createDto = { name: 'Acme', icp: false }

beforeEach(() => {
  vi.mocked(enrichCompany).mockReset()
  mockedCustomFieldValueRepo.listByRecords.mockResolvedValue(ok([]))
  mockedCustomFieldValueRepo.applyForRecord.mockResolvedValue(ok(undefined))
  mockedCustomFieldDefRepo.listByWorkspace.mockResolvedValue(
    ok([textDefinition()]),
  )
})

describe('CrmCompanyService', () => {
  describe('permission matrix (companies)', () => {
    it.each([
      ['VIEWER', 'create'],
      ['VIEWER', 'update'],
      ['VIEWER', 'remove'],
      ['VIEWER', 'reorder'],
      ['MEMBER', 'remove'],
    ] as const)(
      'should forbid a %s from calling %s()',
      async (role, action) => {
        asRole(role)

        const result =
          action === 'create'
            ? await CrmCompanyService.create('u1', 'ws1', createDto)
            : action === 'update'
              ? await CrmCompanyService.update('u1', 'ws1', 'c1', { name: 'X' })
              : action === 'remove'
                ? await CrmCompanyService.remove('u1', 'ws1', 'c1')
                : await CrmCompanyService.reorder('u1', 'ws1', ['c1'])

        expectErr(result, 'FORBIDDEN')
        expect(mockedCompanyRepo.findById).not.toHaveBeenCalled()
        expect(mockedCompanyRepo.create).not.toHaveBeenCalled()
        expect(mockedCompanyRepo.reorder).not.toHaveBeenCalled()
      },
    )

    it('should let a VIEWER read companies', async () => {
      asRole('VIEWER')
      mockedCompanyRepo.listByWorkspace.mockResolvedValue(
        ok([createFakeCrmCompany()]),
      )

      expect(
        expectOk(await CrmCompanyService.list('u1', 'ws1', { icp: undefined })),
      ).toHaveLength(1)
    })

    it('should return MODULE_DISABLED when the CRM is off', async () => {
      asRole('OWNER')
      vi.mocked(
        WorkspaceModuleAccessRepository.isEnabled,
      ).mockResolvedValueOnce(ok(false))

      expectErr(
        await CrmCompanyService.list('u1', 'ws1', { icp: undefined }),
        'MODULE_DISABLED',
      )
      expect(mockedCompanyRepo.listByWorkspace).not.toHaveBeenCalled()
    })

    it('should return WORKSPACE_SUSPENDED for a suspended workspace', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(
          createFakeMembership({ role: 'OWNER', workspaceStatus: 'SUSPENDED' }),
        ),
      )

      expectErr(
        await CrmCompanyService.getById('u1', 'ws1', 'c1'),
        'WORKSPACE_SUSPENDED',
      )
    })
  })

  describe('list()', () => {
    it('should return companies with their custom fields, filtered by ICP', async () => {
      asRole('MEMBER')
      mockedCompanyRepo.listByWorkspace.mockResolvedValue(
        ok([createFakeCrmCompany({ id: 'c1', workspaceId: 'ws1' })]),
      )
      mockedCustomFieldValueRepo.listByRecords.mockResolvedValue(
        ok([{ recordId: 'c1', definitionId: 'def1', value: 'VIP' }] as never),
      )

      const dtos = expectOk(
        await CrmCompanyService.list('u1', 'ws1', { icp: true }),
      )

      expect(dtos).toHaveLength(1)
      expect(dtos[0].customFields).toEqual({ cf_def1: 'VIP' })
      expect(mockedCompanyRepo.listByWorkspace).toHaveBeenCalledWith('ws1', {
        icp: true,
      })
    })

    it('should return FORBIDDEN for a non-member', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))

      expectErr(
        await CrmCompanyService.list('u1', 'ws1', { icp: undefined }),
        'FORBIDDEN',
      )
    })

    it('should propagate repository errors', async () => {
      asRole('MEMBER')
      mockedCompanyRepo.listByWorkspace.mockResolvedValue(err(databaseError()))

      expectErr(
        await CrmCompanyService.list('u1', 'ws1', { icp: undefined }),
        'DATABASE_ERROR',
      )
    })
  })

  describe('getById()', () => {
    it('should return the company with custom fields', async () => {
      asRole('VIEWER')
      mockedCompanyRepo.findById.mockResolvedValue(
        ok(createFakeCrmCompany({ id: 'c1', name: 'Acme' })),
      )

      const dto = expectOk(await CrmCompanyService.getById('u1', 'ws1', 'c1'))

      expect(dto.name).toBe('Acme')
      expect(dto.customFields).toEqual({})
      expect(mockedCompanyRepo.findById).toHaveBeenCalledWith('c1', 'ws1')
    })

    it('should return FORBIDDEN for a non-member', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))

      expectErr(await CrmCompanyService.getById('u1', 'ws1', 'c1'), 'FORBIDDEN')
    })

    it('should propagate NOT_FOUND', async () => {
      asRole('MEMBER')
      mockedCompanyRepo.findById.mockResolvedValue(err(notFound('Company')))

      expectErr(
        await CrmCompanyService.getById('u1', 'ws1', 'c1'),
        'RESOURCE_NOT_FOUND',
      )
    })
  })

  describe('create()', () => {
    it('should create a company, record activity and dispatch workflows', async () => {
      asRole('MEMBER')
      mockedCompanyRepo.create.mockResolvedValue(
        ok(createFakeCrmCompany({ id: 'c1', name: 'Acme' })),
      )

      const dto = expectOk(
        await CrmCompanyService.create('u1', 'ws1', {
          ...createDto,
          accountOwnerId: 'o1',
        }),
      )

      expect(dto.name).toBe('Acme')
      expect(mockedCompanyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'ws1',
          createdById: 'u1',
          accountOwnerId: 'o1',
        }),
      )
      expect(mockedActivityRepo.record).toHaveBeenCalledWith(
        expect.objectContaining({ entity: 'company', action: 'CREATED' }),
      )
      expect(mockedDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ entity: 'company', event: 'created' }),
      )
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'create', targetId: 'c1' }),
      )
      expect(mockedCustomFieldValueRepo.applyForRecord).not.toHaveBeenCalled()
    })

    it('should apply custom field values when provided', async () => {
      asRole('MEMBER')
      mockedCompanyRepo.create.mockResolvedValue(
        ok(createFakeCrmCompany({ id: 'c1' })),
      )

      expectOk(
        await CrmCompanyService.create('u1', 'ws1', {
          ...createDto,
          customFields: { def1: 'Enterprise' },
        }),
      )

      expect(mockedCustomFieldDefRepo.listByWorkspace).toHaveBeenCalledWith(
        'ws1',
        { entity: 'COMPANY' },
      )
      expect(mockedCustomFieldValueRepo.applyForRecord).toHaveBeenCalledWith([
        { definitionId: 'def1', recordId: 'c1', value: 'Enterprise' },
      ])
    })

    it('should return the custom field error without recording activity', async () => {
      asRole('MEMBER')
      mockedCompanyRepo.create.mockResolvedValue(
        ok(createFakeCrmCompany({ id: 'c1' })),
      )
      mockedCustomFieldDefRepo.listByWorkspace.mockResolvedValue(
        ok([textDefinition({ required: true })]),
      )

      expectErr(
        await CrmCompanyService.create('u1', 'ws1', {
          ...createDto,
          customFields: { def1: '' },
        }),
        'CRM_CUSTOM_FIELD_INVALID',
      )
      expect(mockedActivityRepo.record).not.toHaveBeenCalled()
      expect(mockedDispatch).not.toHaveBeenCalled()
    })

    it('should propagate a failure loading custom field values', async () => {
      asRole('MEMBER')
      mockedCompanyRepo.create.mockResolvedValue(
        ok(createFakeCrmCompany({ id: 'c1' })),
      )
      mockedCustomFieldValueRepo.listByRecords.mockResolvedValue(
        err(databaseError()),
      )

      expectErr(
        await CrmCompanyService.create('u1', 'ws1', createDto),
        'DATABASE_ERROR',
      )
      expect(mockedDispatch).not.toHaveBeenCalled()
    })

    it('should audit and propagate repository errors', async () => {
      asRole('MEMBER')
      mockedCompanyRepo.create.mockResolvedValue(err(databaseError()))

      expectErr(
        await CrmCompanyService.create('u1', 'ws1', createDto),
        'DATABASE_ERROR',
      )
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'create',
          outcome: 'failure',
          reason: 'DATABASE_ERROR',
        }),
      )
    })
  })

  describe('CNPJ enrichment', () => {
    const CNPJ = '11.222.333/0001-81'
    const mockedEnrich = vi.mocked(enrichCompany)
    const enrichedResult = (company: CrmCompany) =>
      ok({
        company: toCrmCompanyDTO(company),
        enrichment: {} as never,
        applied: ['legalName' as const],
      })

    it('enriches a new company with a valid CNPJ (overwrite=false) and uses the complete record in events', async () => {
      asRole('MEMBER')
      const created = createFakeCrmCompany({ id: 'c1', cnpj: CNPJ })
      mockedCompanyRepo.create.mockResolvedValue(ok(created))
      mockedEnrich.mockResolvedValue(
        enrichedResult({ ...created, legalName: 'ACME LTDA' }),
      )

      const dto = expectOk(
        await CrmCompanyService.create('u1', 'ws1', {
          ...createDto,
          cnpj: CNPJ,
        }),
      )

      expect(mockedEnrich).toHaveBeenCalledWith(
        expect.objectContaining({ overwrite: false, company: created }),
      )
      expect(dto.legalName).toBe('ACME LTDA')
      expect(mockedDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          record: expect.objectContaining({ legalName: 'ACME LTDA' }),
        }),
      )
    })

    it('passes the registry fields to the repository', async () => {
      asRole('MEMBER')
      mockedCompanyRepo.create.mockResolvedValue(ok(createFakeCrmCompany()))
      expectOk(
        await CrmCompanyService.create('u1', 'ws1', {
          ...createDto,
          emails: ['a@b.com'],
          size: 'ME',
          openedAt: '2020-01-02',
          shareCapital: 10,
        }),
      )
      expect(mockedCompanyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          emails: ['a@b.com'],
          size: 'ME',
          openedAt: '2020-01-02',
          shareCapital: 10,
        }),
      )
    })

    it('keeps the plain record when the lookup fails', async () => {
      asRole('MEMBER')
      mockedCompanyRepo.create.mockResolvedValue(
        ok(createFakeCrmCompany({ id: 'c1', cnpj: CNPJ })),
      )
      mockedEnrich.mockResolvedValue(err(databaseError('boom')))

      const dto = expectOk(
        await CrmCompanyService.create('u1', 'ws1', {
          ...createDto,
          cnpj: CNPJ,
        }),
      )
      expect(dto.id).toBe('c1')
    })

    it('keeps the plain record when the lookup throws', async () => {
      asRole('MEMBER')
      mockedCompanyRepo.create.mockResolvedValue(
        ok(createFakeCrmCompany({ id: 'c1', cnpj: CNPJ })),
      )
      mockedEnrich.mockRejectedValue(new Error('network'))

      expectOk(
        await CrmCompanyService.create('u1', 'ws1', {
          ...createDto,
          cnpj: CNPJ,
        }),
      )
    })

    it.each([
      ['an invalid CNPJ', { cnpj: '12345678000100' }, undefined],
      ['no CNPJ', {}, undefined],
      ['enrich: false', { cnpj: CNPJ }, { enrich: false }],
    ])('does not look up with %s', async (_n, extra, options) => {
      asRole('MEMBER')
      mockedCompanyRepo.create.mockResolvedValue(ok(createFakeCrmCompany()))
      expectOk(
        await CrmCompanyService.create(
          'u1',
          'ws1',
          { ...createDto, ...extra },
          options,
        ),
      )
      expect(mockedEnrich).not.toHaveBeenCalled()
    })

    it('does not look up when the insert fails', async () => {
      asRole('MEMBER')
      mockedCompanyRepo.create.mockResolvedValue(err(databaseError('x')))
      expectErr(
        await CrmCompanyService.create('u1', 'ws1', {
          ...createDto,
          cnpj: CNPJ,
        }),
        'DATABASE_ERROR',
      )
      expect(mockedEnrich).not.toHaveBeenCalled()
    })

    it('enriches on update when the CNPJ changes to another valid one', async () => {
      asRole('MEMBER')
      mockedCompanyRepo.findById.mockResolvedValue(
        ok(createFakeCrmCompany({ id: 'c1', cnpj: null })),
      )
      const updated = createFakeCrmCompany({ id: 'c1', cnpj: CNPJ })
      mockedCompanyRepo.update.mockResolvedValue(ok(updated))
      mockedEnrich.mockResolvedValue(
        enrichedResult({ ...updated, tradeName: 'Acme' }),
      )

      const dto = expectOk(
        await CrmCompanyService.update('u1', 'ws1', 'c1', { cnpj: CNPJ }),
      )
      expect(mockedEnrich).toHaveBeenCalledWith(
        expect.objectContaining({ overwrite: false }),
      )
      expect(dto.tradeName).toBe('Acme')
    })

    it('does not enrich on update when the CNPJ is unchanged, invalid or cleared', async () => {
      asRole('MEMBER')
      mockedCompanyRepo.findById.mockResolvedValue(
        ok(createFakeCrmCompany({ id: 'c1', cnpj: '11222333000181' })),
      )
      mockedCompanyRepo.update.mockResolvedValue(
        ok(createFakeCrmCompany({ id: 'c1' })),
      )
      for (const cnpj of [CNPJ, '123', null]) {
        expectOk(await CrmCompanyService.update('u1', 'ws1', 'c1', { cnpj }))
      }
      expect(mockedEnrich).not.toHaveBeenCalled()
    })

    it('passes registry fields on update', async () => {
      asRole('MEMBER')
      mockedCompanyRepo.findById.mockResolvedValue(
        ok(createFakeCrmCompany({ id: 'c1' })),
      )
      mockedCompanyRepo.update.mockResolvedValue(
        ok(createFakeCrmCompany({ id: 'c1' })),
      )
      expectOk(
        await CrmCompanyService.update('u1', 'ws1', 'c1', {
          legalName: null,
          openedAt: null,
          phones: ['(11) 2395-8400'],
        }),
      )
      expect(mockedCompanyRepo.update).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({
          legalName: null,
          openedAt: null,
          phones: ['(11) 2395-8400'],
        }),
      )
    })
  })

  describe('update()', () => {
    it('should update the company, record activity and dispatch workflows', async () => {
      asRole('MEMBER')
      mockedCompanyRepo.findById.mockResolvedValue(
        ok(createFakeCrmCompany({ id: 'c1' })),
      )
      mockedCompanyRepo.update.mockResolvedValue(
        ok(createFakeCrmCompany({ id: 'c1', name: 'Novo' })),
      )

      const dto = expectOk(
        await CrmCompanyService.update('u1', 'ws1', 'c1', {
          name: 'Novo',
          accountOwnerId: null,
        }),
      )

      expect(dto.name).toBe('Novo')
      expect(mockedCompanyRepo.update).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({
          name: 'Novo',
          accountOwnerId: null,
          updatedById: 'u1',
        }),
      )
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'update',
          meta: { fields: ['name', 'accountOwnerId'] },
        }),
      )
      expect(mockedActivityRepo.record).toHaveBeenCalledWith(
        expect.objectContaining({ entity: 'company', action: 'UPDATED' }),
      )
      expect(mockedDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'updated' }),
      )
    })

    it('should apply custom fields on update', async () => {
      asRole('MEMBER')
      mockedCompanyRepo.findById.mockResolvedValue(
        ok(createFakeCrmCompany({ id: 'c1' })),
      )
      mockedCompanyRepo.update.mockResolvedValue(
        ok(createFakeCrmCompany({ id: 'c1' })),
      )

      expectOk(
        await CrmCompanyService.update('u1', 'ws1', 'c1', {
          customFields: { def1: 'SMB' },
        }),
      )
      expect(mockedCustomFieldValueRepo.applyForRecord).toHaveBeenCalledWith([
        { definitionId: 'def1', recordId: 'c1', value: 'SMB' },
      ])
    })

    it('should propagate custom field errors on update', async () => {
      asRole('MEMBER')
      mockedCompanyRepo.findById.mockResolvedValue(
        ok(createFakeCrmCompany({ id: 'c1' })),
      )
      mockedCompanyRepo.update.mockResolvedValue(
        ok(createFakeCrmCompany({ id: 'c1' })),
      )
      mockedCustomFieldValueRepo.applyForRecord.mockResolvedValue(
        err(databaseError()),
      )

      expectErr(
        await CrmCompanyService.update('u1', 'ws1', 'c1', {
          customFields: { def1: 'SMB' },
        }),
        'DATABASE_ERROR',
      )
      expect(mockedDispatch).not.toHaveBeenCalled()
    })

    it('should propagate a failure merging custom fields', async () => {
      asRole('MEMBER')
      mockedCompanyRepo.findById.mockResolvedValue(
        ok(createFakeCrmCompany({ id: 'c1' })),
      )
      mockedCompanyRepo.update.mockResolvedValue(
        ok(createFakeCrmCompany({ id: 'c1' })),
      )
      mockedCustomFieldValueRepo.listByRecords.mockResolvedValue(
        err(databaseError()),
      )

      expectErr(
        await CrmCompanyService.update('u1', 'ws1', 'c1', { name: 'X' }),
        'DATABASE_ERROR',
      )
    })

    it('should return NOT_FOUND when the company does not exist', async () => {
      asRole('MEMBER')
      mockedCompanyRepo.findById.mockResolvedValue(err(notFound('Company')))

      expectErr(
        await CrmCompanyService.update('u1', 'ws1', 'c1', { name: 'X' }),
        'RESOURCE_NOT_FOUND',
      )
      expect(mockedCompanyRepo.update).not.toHaveBeenCalled()
    })

    it('should audit and propagate repository errors', async () => {
      asRole('MEMBER')
      mockedCompanyRepo.findById.mockResolvedValue(
        ok(createFakeCrmCompany({ id: 'c1' })),
      )
      mockedCompanyRepo.update.mockResolvedValue(err(databaseError()))

      expectErr(
        await CrmCompanyService.update('u1', 'ws1', 'c1', { name: 'X' }),
        'DATABASE_ERROR',
      )
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'update',
          outcome: 'failure',
          targetId: 'c1',
        }),
      )
    })
  })

  describe('remove()', () => {
    it('should soft delete an existing company', async () => {
      asRole('ADMIN')
      mockedCompanyRepo.findById.mockResolvedValue(
        ok(createFakeCrmCompany({ id: 'c1' })),
      )
      mockedCompanyRepo.softDelete.mockResolvedValue(ok(undefined))

      expectOk(await CrmCompanyService.remove('u1', 'ws1', 'c1'))

      expect(mockedCompanyRepo.softDelete).toHaveBeenCalledWith('c1')
      expect(mockedActivityRepo.record).toHaveBeenCalledWith(
        expect.objectContaining({ entity: 'company', action: 'DELETED' }),
      )
      expect(mockedDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'deleted' }),
      )
    })

    it('should return NOT_FOUND when the company does not exist', async () => {
      asRole('ADMIN')
      mockedCompanyRepo.findById.mockResolvedValue(err(notFound('Company')))

      expectErr(
        await CrmCompanyService.remove('u1', 'ws1', 'c1'),
        'RESOURCE_NOT_FOUND',
      )
      expect(mockedCompanyRepo.softDelete).not.toHaveBeenCalled()
    })

    it('should propagate soft delete errors', async () => {
      asRole('OWNER')
      mockedCompanyRepo.findById.mockResolvedValue(
        ok(createFakeCrmCompany({ id: 'c1' })),
      )
      mockedCompanyRepo.softDelete.mockResolvedValue(err(databaseError()))

      expectErr(
        await CrmCompanyService.remove('u1', 'ws1', 'c1'),
        'DATABASE_ERROR',
      )
      expect(mockedAudit).not.toHaveBeenCalled()
    })
  })

  describe('reorder()', () => {
    it('should delegate to the repository for a member', async () => {
      asRole('MEMBER')
      mockedCompanyRepo.reorder.mockResolvedValue(ok(undefined))

      expectOk(await CrmCompanyService.reorder('u1', 'ws1', ['c2', 'c1']))
      expect(mockedCompanyRepo.reorder).toHaveBeenCalledWith('ws1', [
        'c2',
        'c1',
      ])
    })
  })
})
