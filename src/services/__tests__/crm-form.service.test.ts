import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeCrmForm,
  createFakeCrmFormSubmission,
} from '@/src/__tests__/factories/crm-form.factory'
import { createFakeCrmLead } from '@/src/__tests__/factories/crm-lead.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, notFound } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/services/crm-notifications')
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-form.repository')
vi.mock('@/src/repositories/crm-lead.repository')
vi.mock('@/src/repositories/crm-lead-scoring-rule.repository')
vi.mock('@/src/repositories/crm-lead-routing-rule.repository')
vi.mock('@/src/repositories/crm-company.repository')
vi.mock('@/src/repositories/crm-person.repository')
vi.mock('@/src/services/crm-workflow-dispatcher')
vi.mock('@/src/services/crm-campaign-tracking.service')

import { CrmCompanyRepository } from '@/src/repositories/crm-company.repository'
import {
  CrmFormRepository,
  CrmFormSubmissionRepository,
} from '@/src/repositories/crm-form.repository'
import { CrmLeadRepository } from '@/src/repositories/crm-lead.repository'
import { CrmLeadRoutingRuleRepository } from '@/src/repositories/crm-lead-routing-rule.repository'
import { CrmLeadScoringRuleRepository } from '@/src/repositories/crm-lead-scoring-rule.repository'
import { CrmPersonRepository } from '@/src/repositories/crm-person.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { CrmCampaignTrackingService } from '../crm-campaign-tracking.service'
import { CrmFormService } from '../crm-form.service'
import {
  notifyCrmFormSubmitted,
  notifyCrmLeadAssigned,
} from '../crm-notifications'

const mockedModuleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const mockedCompanyRepo = vi.mocked(CrmCompanyRepository)
const mockedPersonRepo = vi.mocked(CrmPersonRepository)
const mockedMembershipRepo = vi.mocked(MembershipRepository)
const mockedFormRepo = vi.mocked(CrmFormRepository)
const mockedSubmissionRepo = vi.mocked(CrmFormSubmissionRepository)
const mockedLeadRepo = vi.mocked(CrmLeadRepository)
const mockedScoringRepo = vi.mocked(CrmLeadScoringRuleRepository)
const mockedRoutingRepo = vi.mocked(CrmLeadRoutingRuleRepository)

function mockLeadIntake() {
  mockedLeadRepo.findOpenByContacts.mockResolvedValue(ok(null))
  mockedScoringRepo.listActiveByWorkspace.mockResolvedValue(ok([]))
  mockedRoutingRepo.listActiveByWorkspace.mockResolvedValue(ok([]))
}

function fakeSubmission(createdLeadId: string | null) {
  return {
    id: 's1',
    formId: 'f1',
    values: {},
    action: 'LEAD' as const,
    createdPersonId: null,
    createdCompanyId: null,
    createdLeadId,
    ipHash: 'hashed',
    referrer: null,
    createdAt: new Date(),
  }
}

const leadForm = (fields: unknown[]) =>
  createFakeCrmForm({
    id: 'f1',
    action: 'LEAD',
    workspaceId: 'ws1',
    createdById: 'owner1',
    fields: fields as never,
  })

describe('CrmFormService', () => {
  describe('list()', () => {
    it('should return FORBIDDEN for a non-member', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
      expectErr(await CrmFormService.list('u1', 'ws1'), 'FORBIDDEN')
    })
  })

  describe('update() phase cross-validation', () => {
    it('should reject a PATCH with only fields when a field references a phase absent from the saved record', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok({ id: 'm1', role: 'OWNER' } as never),
      )
      mockedFormRepo.findById.mockResolvedValue(
        ok(createFakeCrmForm({ id: 'f1', workspaceId: 'ws1', phases: [] })),
      )

      const result = await CrmFormService.update('u1', 'ws1', 'f1', {
        fields: [
          {
            key: 'x',
            label: 'X',
            type: 'text',
            required: false,
            mapping: { target: 'lead', attribute: 'name' },
            phaseId: 'phase-that-no-longer-exists',
          },
        ],
      })
      expectErr(result, 'VALIDATION_ERROR')
    })

    it('should accept a PATCH with only phases when existing fields have no phaseId', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok({ id: 'm1', role: 'OWNER' } as never),
      )
      mockedFormRepo.findById.mockResolvedValue(
        ok(
          createFakeCrmForm({
            id: 'f1',
            workspaceId: 'ws1',
            fields: [
              {
                key: 'name',
                label: 'Nome',
                type: 'text',
                required: false,
                mapping: { target: 'lead', attribute: 'name' },
              },
            ],
          }),
        ),
      )
      mockedFormRepo.update.mockResolvedValue(
        ok(createFakeCrmForm({ id: 'f1', workspaceId: 'ws1' })),
      )

      const result = await CrmFormService.update('u1', 'ws1', 'f1', {
        phases: [{ id: 'p1', title: 'Fase 1' }],
      })
      expectOk(result)
    })
  })

  describe('submit()', () => {
    it('should apply field mappings and create a lead + submission for a LEAD-action form', async () => {
      mockedFormRepo.findPublishedByPublicToken.mockResolvedValue(
        ok(
          createFakeCrmForm({
            id: 'f1',
            action: 'LEAD',
            workspaceId: 'ws1',
            createdById: 'owner1',
            fields: [
              {
                key: 'full_name',
                label: 'Nome',
                type: 'text',
                required: true,
                mapping: { target: 'lead', attribute: 'name' },
              },
              {
                key: 'work_email',
                label: 'E-mail',
                type: 'email',
                required: true,
                mapping: { target: 'lead', attribute: 'email' },
              },
            ],
          }),
        ),
      )
      mockLeadIntake()
      mockedLeadRepo.create.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'lead1' })),
      )
      mockedSubmissionRepo.create.mockResolvedValue(
        ok({
          id: 's1',
          formId: 'f1',
          values: { full_name: 'Jane', work_email: 'jane@acme.com' },
          action: 'LEAD',
          createdPersonId: null,
          createdCompanyId: null,
          createdLeadId: 'lead1',
          ipHash: 'hashed',
          referrer: null,
          createdAt: new Date(),
        }),
      )

      const dto = expectOk(
        await CrmFormService.submit('tok', '1.2.3.4', undefined, {
          values: { full_name: 'Jane', work_email: 'jane@acme.com' },
          campaign: { ref: 'campaign-token', utmSource: 'email' },
        }),
      )
      expect(dto.createdLeadId).toBe('lead1')
      // Campaign attribution of the submission (multichannel campaigns).
      expect(CrmCampaignTrackingService.attribute).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'FORM_SUBMISSION',
          sourceRef: 's1',
          formId: 'f1',
          leadId: 'lead1',
        }),
        expect.any(Date),
      )
      expect(mockedLeadRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'ws1',
          createdById: 'owner1',
          name: 'Jane',
          emails: ['jane@acme.com'],
        }),
      )
    })

    it('should fall back to a default name when no name mapping matched', async () => {
      mockedFormRepo.findPublishedByPublicToken.mockResolvedValue(
        ok(
          leadForm([
            {
              key: 'tel',
              label: 'Telefone',
              type: 'text',
              required: true,
              mapping: { target: 'lead', attribute: 'phone' },
            },
          ]),
        ),
      )
      mockLeadIntake()
      mockedLeadRepo.create.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'lead1' })),
      )
      mockedSubmissionRepo.create.mockResolvedValue(ok(fakeSubmission('lead1')))

      expectOk(
        await CrmFormService.submit('tok', '1.2.3.4', undefined, {
          values: { tel: '81999990000' },
        }),
      )
      expect(mockedLeadRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Sem nome', source: 'form' }),
      )
    })

    it('should reject a lead submission without e-mail or phone', async () => {
      mockedFormRepo.findPublishedByPublicToken.mockResolvedValue(
        ok(leadForm([])),
      )

      expectErr(
        await CrmFormService.submit('tok', '1.2.3.4', undefined, {
          values: {},
        }),
        'VALIDATION_ERROR',
      )
      expect(mockedLeadRepo.create).not.toHaveBeenCalled()
      expect(mockedSubmissionRepo.create).not.toHaveBeenCalled()
    })

    it('should link the submission to an existing open lead (dedupe)', async () => {
      mockedFormRepo.findPublishedByPublicToken.mockResolvedValue(
        ok(
          leadForm([
            {
              key: 'email',
              label: 'E-mail',
              type: 'email',
              required: true,
              mapping: { target: 'lead', attribute: 'email' },
            },
          ]),
        ),
      )
      mockLeadIntake()
      mockedLeadRepo.findOpenByContacts.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'lead0' })),
      )
      mockedSubmissionRepo.create.mockResolvedValue(ok(fakeSubmission('lead0')))

      expectOk(
        await CrmFormService.submit('tok', '1.2.3.4', undefined, {
          values: { email: 'jane@acme.com' },
        }),
      )
      expect(mockedLeadRepo.create).not.toHaveBeenCalled()
      expect(mockedSubmissionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ createdLeadId: 'lead0' }),
      )
    })

    it('should score and route form leads like manual creation', async () => {
      mockedFormRepo.findPublishedByPublicToken.mockResolvedValue(
        ok(
          leadForm([
            {
              key: 'email',
              label: 'E-mail',
              type: 'email',
              required: true,
              mapping: { target: 'lead', attribute: 'email' },
            },
          ]),
        ),
      )
      mockLeadIntake()
      mockedScoringRepo.listActiveByWorkspace.mockResolvedValue(
        ok([
          {
            id: 'r1',
            workspaceId: 'ws1',
            field: 'email',
            operator: 'is_not_empty',
            value: null,
            points: 20,
            active: true,
            position: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
      )
      mockedRoutingRepo.listActiveByWorkspace.mockResolvedValue(
        ok([
          {
            id: 'rr1',
            workspaceId: 'ws1',
            field: 'source',
            operator: 'equals',
            value: 'form',
            ownerId: 'seller1',
            active: true,
            position: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
      )
      mockedLeadRepo.create.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'lead1' })),
      )
      mockedSubmissionRepo.create.mockResolvedValue(ok(fakeSubmission('lead1')))

      expectOk(
        await CrmFormService.submit('tok', '1.2.3.4', undefined, {
          values: { email: 'jane@acme.com' },
        }),
      )
      expect(mockedLeadRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          score: 20,
          ownerId: 'seller1',
          createdById: 'owner1',
        }),
      )
    })
  })
})

describe('CrmFormService (extended)', () => {
  const asRole = (role: 'OWNER' | 'MEMBER' | 'VIEWER') =>
    mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership({ role })),
    )
  const form = (overrides = {}) =>
    createFakeCrmForm({ id: 'f1', workspaceId: 'ws1', ...overrides })

  describe('list()', () => {
    it('should return MODULE_DISABLED when CRM is off for the workspace', async () => {
      asRole('MEMBER')
      mockedModuleAccess.isEnabled.mockResolvedValueOnce(ok(false))
      expectErr(await CrmFormService.list('u1', 'ws1'), 'MODULE_DISABLED')
      expect(mockedFormRepo.listByWorkspace).not.toHaveBeenCalled()
    })

    it('should return WORKSPACE_SUSPENDED for a suspended workspace', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ workspaceStatus: 'SUSPENDED' })),
      )
      expectErr(await CrmFormService.list('u1', 'ws1'), 'WORKSPACE_SUSPENDED')
    })

    it('should list forms for a VIEWER', async () => {
      asRole('VIEWER')
      mockedFormRepo.listByWorkspace.mockResolvedValue(ok([form()]))
      const dtos = expectOk(await CrmFormService.list('u1', 'ws1'))
      expect(dtos.map((d) => d.id)).toEqual(['f1'])
    })

    it('should propagate a repository error', async () => {
      asRole('MEMBER')
      mockedFormRepo.listByWorkspace.mockResolvedValue(
        err(databaseError('boom')),
      )
      expectErr(await CrmFormService.list('u1', 'ws1'), 'DATABASE_ERROR')
    })
  })

  describe('getById()', () => {
    it('should return FORBIDDEN for a non-member', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
      expectErr(await CrmFormService.getById('u1', 'ws1', 'f1'), 'FORBIDDEN')
    })

    it('should return the form', async () => {
      asRole('MEMBER')
      mockedFormRepo.findById.mockResolvedValue(ok(form({ name: 'Contato' })))
      const dto = expectOk(await CrmFormService.getById('u1', 'ws1', 'f1'))
      expect(dto.name).toBe('Contato')
      expect(mockedFormRepo.findById).toHaveBeenCalledWith('f1', 'ws1')
    })

    it('should return RESOURCE_NOT_FOUND for a form of another workspace', async () => {
      asRole('MEMBER')
      mockedFormRepo.findById.mockResolvedValue(err(notFound('Formulário')))
      expectErr(
        await CrmFormService.getById('u1', 'ws1', 'f1'),
        'RESOURCE_NOT_FOUND',
      )
    })
  })

  describe('create()', () => {
    const dto = {
      name: 'Contato',
      action: 'LEAD' as const,
      fields: [],
      phases: [],
    }

    it('should return FORBIDDEN for a VIEWER', async () => {
      asRole('VIEWER')
      expectErr(await CrmFormService.create('u1', 'ws1', dto), 'FORBIDDEN')
      expect(mockedFormRepo.create).not.toHaveBeenCalled()
    })

    it('should create the form for a MEMBER', async () => {
      asRole('MEMBER')
      mockedFormRepo.create.mockResolvedValue(ok(form({ name: 'Contato' })))
      const created = expectOk(await CrmFormService.create('u1', 'ws1', dto))
      expect(created.id).toBe('f1')
      expect(mockedFormRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'ws1',
          createdById: 'u1',
          name: 'Contato',
          action: 'LEAD',
        }),
      )
    })

    it('should propagate a repository error', async () => {
      asRole('MEMBER')
      mockedFormRepo.create.mockResolvedValue(err(databaseError('boom')))
      expectErr(await CrmFormService.create('u1', 'ws1', dto), 'DATABASE_ERROR')
    })
  })

  describe('update()', () => {
    it('should return FORBIDDEN for a VIEWER', async () => {
      asRole('VIEWER')
      expectErr(
        await CrmFormService.update('u1', 'ws1', 'f1', { name: 'x' }),
        'FORBIDDEN',
      )
    })

    it('should return RESOURCE_NOT_FOUND when the form does not exist', async () => {
      asRole('MEMBER')
      mockedFormRepo.findById.mockResolvedValue(err(notFound('Formulário')))
      expectErr(
        await CrmFormService.update('u1', 'ws1', 'f1', { name: 'x' }),
        'RESOURCE_NOT_FOUND',
      )
      expect(mockedFormRepo.update).not.toHaveBeenCalled()
    })

    it('should leave status and publishedAt untouched when status is absent', async () => {
      asRole('MEMBER')
      mockedFormRepo.findById.mockResolvedValue(ok(form()))
      mockedFormRepo.update.mockResolvedValue(ok(form({ name: 'Novo' })))
      expectOk(await CrmFormService.update('u1', 'ws1', 'f1', { name: 'Novo' }))
      expect(mockedFormRepo.update).toHaveBeenCalledWith(
        'f1',
        expect.objectContaining({
          name: 'Novo',
          status: undefined,
          publishedAt: undefined,
          updatedById: 'u1',
        }),
      )
    })

    it('should stamp publishedAt when publishing', async () => {
      asRole('MEMBER')
      mockedFormRepo.findById.mockResolvedValue(ok(form()))
      mockedFormRepo.update.mockResolvedValue(ok(form({ status: 'PUBLISHED' })))
      expectOk(
        await CrmFormService.update('u1', 'ws1', 'f1', { status: 'PUBLISHED' }),
      )
      expect(mockedFormRepo.update.mock.calls[0][1].publishedAt).toBeInstanceOf(
        Date,
      )
    })

    it('should clear publishedAt when moving back to draft', async () => {
      asRole('MEMBER')
      mockedFormRepo.findById.mockResolvedValue(ok(form()))
      mockedFormRepo.update.mockResolvedValue(ok(form()))
      expectOk(
        await CrmFormService.update('u1', 'ws1', 'f1', { status: 'DRAFT' }),
      )
      expect(mockedFormRepo.update.mock.calls[0][1].publishedAt).toBeNull()
    })

    it('should validate fields against saved phases when the record has null json', async () => {
      asRole('MEMBER')
      mockedFormRepo.findById.mockResolvedValue(
        ok(form({ fields: null, phases: null })),
      )
      expectErr(
        await CrmFormService.update('u1', 'ws1', 'f1', {
          fields: [
            {
              key: 'x',
              label: 'X',
              type: 'text',
              required: false,
              mapping: { target: 'lead', attribute: 'name' },
              phaseId: 'ghost',
            },
          ],
        }),
        'VALIDATION_ERROR',
      )
    })

    it('should accept phases-only PATCH when saved fields are null', async () => {
      asRole('MEMBER')
      mockedFormRepo.findById.mockResolvedValue(ok(form({ fields: null })))
      mockedFormRepo.update.mockResolvedValue(ok(form()))
      expectOk(
        await CrmFormService.update('u1', 'ws1', 'f1', {
          phases: [{ id: 'p1', title: 'Fase' }],
        }),
      )
    })

    it('should propagate a repository update error', async () => {
      asRole('MEMBER')
      mockedFormRepo.findById.mockResolvedValue(ok(form()))
      mockedFormRepo.update.mockResolvedValue(err(databaseError('boom')))
      expectErr(
        await CrmFormService.update('u1', 'ws1', 'f1', { name: 'x' }),
        'DATABASE_ERROR',
      )
    })
  })

  describe('setPublished()', () => {
    it('should return FORBIDDEN for a VIEWER', async () => {
      asRole('VIEWER')
      expectErr(
        await CrmFormService.setPublished('u1', 'ws1', 'f1', true),
        'FORBIDDEN',
      )
    })

    it('should return RESOURCE_NOT_FOUND for an unknown form', async () => {
      asRole('MEMBER')
      mockedFormRepo.findById.mockResolvedValue(err(notFound('Formulário')))
      expectErr(
        await CrmFormService.setPublished('u1', 'ws1', 'f1', true),
        'RESOURCE_NOT_FOUND',
      )
      expect(mockedFormRepo.setPublished).not.toHaveBeenCalled()
    })

    it('should publish the form', async () => {
      asRole('MEMBER')
      mockedFormRepo.findById.mockResolvedValue(ok(form()))
      mockedFormRepo.setPublished.mockResolvedValue(
        ok(form({ status: 'PUBLISHED' })),
      )
      const dto = expectOk(
        await CrmFormService.setPublished('u1', 'ws1', 'f1', true),
      )
      expect(dto.status).toBe('PUBLISHED')
      expect(mockedFormRepo.setPublished).toHaveBeenCalledWith('f1', true)
    })

    it('should propagate a repository error', async () => {
      asRole('MEMBER')
      mockedFormRepo.findById.mockResolvedValue(ok(form()))
      mockedFormRepo.setPublished.mockResolvedValue(err(databaseError('boom')))
      expectErr(
        await CrmFormService.setPublished('u1', 'ws1', 'f1', false),
        'DATABASE_ERROR',
      )
    })
  })

  describe('remove()', () => {
    it('should return FORBIDDEN for a MEMBER (no DELETE permission)', async () => {
      asRole('MEMBER')
      expectErr(await CrmFormService.remove('u1', 'ws1', 'f1'), 'FORBIDDEN')
      expect(mockedFormRepo.softDelete).not.toHaveBeenCalled()
    })

    it('should return RESOURCE_NOT_FOUND for an unknown form', async () => {
      asRole('OWNER')
      mockedFormRepo.findById.mockResolvedValue(err(notFound('Formulário')))
      expectErr(
        await CrmFormService.remove('u1', 'ws1', 'f1'),
        'RESOURCE_NOT_FOUND',
      )
    })

    it('should soft-delete the form for an OWNER', async () => {
      asRole('OWNER')
      mockedFormRepo.findById.mockResolvedValue(ok(form()))
      mockedFormRepo.softDelete.mockResolvedValue(ok(undefined))
      expectOk(await CrmFormService.remove('u1', 'ws1', 'f1'))
      expect(mockedFormRepo.softDelete).toHaveBeenCalledWith('f1')
    })

    it('should propagate a soft-delete error', async () => {
      asRole('OWNER')
      mockedFormRepo.findById.mockResolvedValue(ok(form()))
      mockedFormRepo.softDelete.mockResolvedValue(err(databaseError('boom')))
      expectErr(
        await CrmFormService.remove('u1', 'ws1', 'f1'),
        'DATABASE_ERROR',
      )
    })
  })

  describe('reorder()', () => {
    it('should return FORBIDDEN for a VIEWER', async () => {
      asRole('VIEWER')
      expectErr(
        await CrmFormService.reorder('u1', 'ws1', ['f2', 'f1']),
        'FORBIDDEN',
      )
      expect(mockedFormRepo.reorder).not.toHaveBeenCalled()
    })

    it('should delegate the new order to the repository', async () => {
      asRole('MEMBER')
      mockedFormRepo.reorder.mockResolvedValue(ok(undefined))
      expectOk(await CrmFormService.reorder('u1', 'ws1', ['f2', 'f1']))
      expect(mockedFormRepo.reorder).toHaveBeenCalledWith('ws1', ['f2', 'f1'])
    })
  })

  describe('listSubmissions()', () => {
    it('should return FORBIDDEN for a non-member', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
      expectErr(
        await CrmFormService.listSubmissions('u1', 'ws1', 'f1'),
        'FORBIDDEN',
      )
    })

    it('should return RESOURCE_NOT_FOUND for a form of another workspace', async () => {
      asRole('MEMBER')
      mockedFormRepo.findById.mockResolvedValue(err(notFound('Formulário')))
      expectErr(
        await CrmFormService.listSubmissions('u1', 'ws1', 'f1'),
        'RESOURCE_NOT_FOUND',
      )
      expect(mockedSubmissionRepo.listByForm).not.toHaveBeenCalled()
    })

    it('should list the submissions without exposing the ip hash', async () => {
      asRole('MEMBER')
      mockedFormRepo.findById.mockResolvedValue(ok(form()))
      mockedSubmissionRepo.listByForm.mockResolvedValue(
        ok([createFakeCrmFormSubmission({ id: 's1', ipHash: 'abc' })]),
      )
      const dtos = expectOk(
        await CrmFormService.listSubmissions('u1', 'ws1', 'f1'),
      )
      expect(dtos).toHaveLength(1)
      expect(dtos[0].id).toBe('s1')
      expect(dtos[0]).not.toHaveProperty('ipHash')
    })

    it('should propagate a repository error', async () => {
      asRole('MEMBER')
      mockedFormRepo.findById.mockResolvedValue(ok(form()))
      mockedSubmissionRepo.listByForm.mockResolvedValue(
        err(databaseError('boom')),
      )
      expectErr(
        await CrmFormService.listSubmissions('u1', 'ws1', 'f1'),
        'DATABASE_ERROR',
      )
    })
  })

  describe('getPublicByToken()', () => {
    it('should return RESOURCE_NOT_FOUND for an unpublished/unknown token', async () => {
      mockedFormRepo.findPublishedByPublicToken.mockResolvedValue(
        err(notFound('Formulário')),
      )
      expectErr(
        await CrmFormService.getPublicByToken('tok'),
        'RESOURCE_NOT_FOUND',
      )
    })

    it('should return MODULE_DISABLED when CRM is off for the form workspace', async () => {
      mockedFormRepo.findPublishedByPublicToken.mockResolvedValue(ok(form()))
      mockedModuleAccess.isEnabled.mockResolvedValueOnce(ok(false))
      expectErr(await CrmFormService.getPublicByToken('tok'), 'MODULE_DISABLED')
      expect(mockedModuleAccess.isEnabled).toHaveBeenCalledWith('ws1', 'CRM')
    })

    it('should propagate a module access lookup error', async () => {
      mockedFormRepo.findPublishedByPublicToken.mockResolvedValue(ok(form()))
      mockedModuleAccess.isEnabled.mockResolvedValueOnce(
        err(databaseError('boom')),
      )
      expectErr(await CrmFormService.getPublicByToken('tok'), 'DATABASE_ERROR')
    })

    it('should return the public view of the form', async () => {
      mockedFormRepo.findPublishedByPublicToken.mockResolvedValue(
        ok(form({ name: 'Contato' })),
      )
      const dto = expectOk(await CrmFormService.getPublicByToken('tok'))
      expect(dto.name).toBe('Contato')
      expect(dto).not.toHaveProperty('workspaceId')
    })
  })

  describe('submit()', () => {
    beforeEach(() => {
      mockedSubmissionRepo.create.mockImplementation(async (data) =>
        ok(
          createFakeCrmFormSubmission({
            formId: data.formId,
            action: data.action,
            createdCompanyId: data.createdCompanyId ?? null,
            createdPersonId: data.createdPersonId ?? null,
            createdLeadId: data.createdLeadId ?? null,
            ipHash: data.ipHash ?? null,
            referrer: data.referrer ?? null,
          }),
        ),
      )
    })

    const companyFields = [
      ['name', 'name'],
      ['cnpj', 'cnpj'],
      ['domain', 'domain'],
      ['employees', 'employees'],
      ['linkedin', 'linkedin'],
      ['arr', 'arr'],
    ].map(([key, attribute]) => ({
      key,
      label: key,
      type: 'text' as const,
      required: false,
      mapping: { target: 'company' as const, attribute },
    }))

    const personFields = [
      'name',
      'email',
      'phone',
      'city',
      'jobTitle',
      'linkedin',
      'avatar',
    ].map((attribute) => ({
      key: attribute,
      label: attribute,
      type: 'text' as const,
      required: false,
      mapping: { target: 'person' as const, attribute },
    }))

    it('should return RESOURCE_NOT_FOUND for an unknown token', async () => {
      mockedFormRepo.findPublishedByPublicToken.mockResolvedValue(
        err(notFound('Formulário')),
      )
      expectErr(
        await CrmFormService.submit('tok', '1.1.1.1', undefined, {
          values: {},
        }),
        'RESOURCE_NOT_FOUND',
      )
    })

    it('should return MODULE_DISABLED when CRM is off', async () => {
      mockedFormRepo.findPublishedByPublicToken.mockResolvedValue(ok(form()))
      mockedModuleAccess.isEnabled.mockResolvedValueOnce(ok(false))
      expectErr(
        await CrmFormService.submit('tok', '1.1.1.1', undefined, {
          values: {},
        }),
        'MODULE_DISABLED',
      )
      expect(mockedSubmissionRepo.create).not.toHaveBeenCalled()
    })

    it('should create a company with every mapped attribute and hash the ip', async () => {
      mockedFormRepo.findPublishedByPublicToken.mockResolvedValue(
        ok(
          form({
            action: 'COMPANY',
            createdById: 'owner1',
            fields: companyFields,
          }),
        ),
      )
      mockedCompanyRepo.create.mockResolvedValue(ok({ id: 'co1' } as never))

      const dto = expectOk(
        await CrmFormService.submit('tok', '1.1.1.1', 'https://site', {
          values: {
            name: 'Acme',
            cnpj: '123',
            domain: 'acme.com',
            employees: '50',
            linkedin: 'in/acme',
            arr: '1000',
          },
        }),
      )

      expect(dto.createdCompanyId).toBe('co1')
      expect(mockedCompanyRepo.create).toHaveBeenCalledWith({
        workspaceId: 'ws1',
        createdById: 'owner1',
        name: 'Acme',
        cnpj: '123',
        domain: 'acme.com',
        employees: 50,
        linkedin: 'in/acme',
        arr: 1000,
      })
      const saved = mockedSubmissionRepo.create.mock.calls[0][0]
      expect(saved.action).toBe('COMPANY')
      expect(saved.referrer).toBe('https://site')
      expect(saved.ipHash).toMatch(/^[a-f0-9]{64}$/)
      expect(saved.ipHash).not.toContain('1.1.1.1')
    })

    it('should default the company name and skip empty values', async () => {
      mockedFormRepo.findPublishedByPublicToken.mockResolvedValue(
        ok(form({ action: 'COMPANY', fields: companyFields })),
      )
      mockedCompanyRepo.create.mockResolvedValue(ok({ id: 'co1' } as never))

      expectOk(
        await CrmFormService.submit('tok', '1.1.1.1', undefined, {
          values: { name: '', cnpj: '' },
        }),
      )
      expect(mockedCompanyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Sem nome',
          cnpj: undefined,
          domain: undefined,
          employees: undefined,
          linkedin: undefined,
          arr: undefined,
        }),
      )
    })

    it('should propagate a company creation error', async () => {
      mockedFormRepo.findPublishedByPublicToken.mockResolvedValue(
        ok(form({ action: 'COMPANY', fields: null })),
      )
      mockedCompanyRepo.create.mockResolvedValue(err(databaseError('boom')))
      expectErr(
        await CrmFormService.submit('tok', '1.1.1.1', undefined, {
          values: {},
        }),
        'DATABASE_ERROR',
      )
      expect(mockedSubmissionRepo.create).not.toHaveBeenCalled()
    })

    it('should create a person with every mapped attribute', async () => {
      mockedFormRepo.findPublishedByPublicToken.mockResolvedValue(
        ok(
          form({
            action: 'PERSON',
            createdById: 'owner1',
            fields: personFields,
          }),
        ),
      )
      mockedPersonRepo.create.mockResolvedValue(ok({ id: 'pe1' } as never))

      const dto = expectOk(
        await CrmFormService.submit('tok', '1.1.1.1', undefined, {
          values: {
            name: 'Jane',
            email: 'jane@acme.com',
            phone: '8199',
            city: 'Recife',
            jobTitle: 'CTO',
            linkedin: 'in/jane',
            avatar: 'https://a/j.png',
          },
        }),
      )
      expect(dto.createdPersonId).toBe('pe1')
      expect(mockedPersonRepo.create).toHaveBeenCalledWith({
        workspaceId: 'ws1',
        createdById: 'owner1',
        name: 'Jane',
        emails: ['jane@acme.com'],
        phones: ['8199'],
        city: 'Recife',
        jobTitle: 'CTO',
        linkedin: 'in/jane',
        avatar: 'https://a/j.png',
      })
    })

    it('should name the person after the e-mail when no name is sent', async () => {
      mockedFormRepo.findPublishedByPublicToken.mockResolvedValue(
        ok(form({ action: 'PERSON', fields: personFields })),
      )
      mockedPersonRepo.create.mockResolvedValue(ok({ id: 'pe1' } as never))

      expectOk(
        await CrmFormService.submit('tok', '1.1.1.1', undefined, {
          values: { email: 'jane@acme.com' },
        }),
      )
      expect(mockedPersonRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'jane@acme.com',
          phones: [],
          city: undefined,
          jobTitle: undefined,
          linkedin: undefined,
          avatar: undefined,
        }),
      )
    })

    it('should fall back to "Sem nome" for an empty person submission', async () => {
      mockedFormRepo.findPublishedByPublicToken.mockResolvedValue(
        ok(form({ action: 'PERSON', fields: [] })),
      )
      mockedPersonRepo.create.mockResolvedValue(ok({ id: 'pe1' } as never))

      expectOk(
        await CrmFormService.submit('tok', '1.1.1.1', undefined, {
          values: {},
        }),
      )
      expect(mockedPersonRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Sem nome', emails: [] }),
      )
    })

    it('should propagate a person creation error', async () => {
      mockedFormRepo.findPublishedByPublicToken.mockResolvedValue(
        ok(form({ action: 'PERSON', fields: [] })),
      )
      mockedPersonRepo.create.mockResolvedValue(err(databaseError('boom')))
      expectErr(
        await CrmFormService.submit('tok', '1.1.1.1', undefined, {
          values: {},
        }),
        'DATABASE_ERROR',
      )
    })

    it('should forward company, job title and source to the lead intake', async () => {
      mockedFormRepo.findPublishedByPublicToken.mockResolvedValue(
        ok(
          leadForm(
            ['email', 'company', 'jobTitle', 'source'].map((attribute) => ({
              key: attribute,
              label: attribute,
              type: 'text',
              required: false,
              mapping: { target: 'lead', attribute },
            })),
          ),
        ),
      )
      mockLeadIntake()
      mockedLeadRepo.create.mockResolvedValue(
        ok(createFakeCrmLead({ id: 'lead1' })),
      )

      const dto = expectOk(
        await CrmFormService.submit('tok', '1.1.1.1', undefined, {
          values: {
            email: 'jane@acme.com',
            company: 'Acme',
            jobTitle: 'CTO',
            source: 'site',
          },
        }),
      )
      expect(dto.createdLeadId).toBe('lead1')
      expect(mockedLeadRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'jane@acme.com',
          company: 'Acme',
          jobTitle: 'CTO',
          source: 'site',
        }),
      )
    })

    it('should propagate a submission persistence error', async () => {
      mockedFormRepo.findPublishedByPublicToken.mockResolvedValue(
        ok(form({ action: 'COMPANY', fields: [] })),
      )
      mockedCompanyRepo.create.mockResolvedValue(ok({ id: 'co1' } as never))
      mockedSubmissionRepo.create.mockResolvedValue(err(databaseError('boom')))
      expectErr(
        await CrmFormService.submit('tok', '1.1.1.1', undefined, {
          values: {},
        }),
        'DATABASE_ERROR',
      )
    })
  })
})

describe('CrmFormService.submit() notifications', () => {
  const mockedFormSubmitted = vi.mocked(notifyCrmFormSubmitted)
  const mockedLeadAssigned = vi.mocked(notifyCrmLeadAssigned)
  const emailField = {
    key: 'email',
    label: 'E-mail',
    type: 'email',
    required: true,
    mapping: { target: 'lead', attribute: 'email' },
  }

  function routeTo(ownerId: string) {
    mockedRoutingRepo.listActiveByWorkspace.mockResolvedValue(
      ok([
        {
          id: 'rr1',
          workspaceId: 'ws1',
          field: 'source',
          operator: 'equals',
          value: 'form',
          ownerId,
          active: true,
          position: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockedModuleAccess.isEnabled.mockResolvedValue(ok(true))
    mockedFormRepo.findPublishedByPublicToken.mockResolvedValue(
      ok(leadForm([emailField])),
    )
    mockLeadIntake()
    mockedSubmissionRepo.create.mockResolvedValue(ok(fakeSubmission('lead1')))
  })

  it('should notify the form owner when the lead went to someone else', async () => {
    routeTo('seller1')
    mockedLeadRepo.create.mockResolvedValue(
      ok(createFakeCrmLead({ id: 'lead1', ownerId: 'seller1' })),
    )

    expectOk(
      await CrmFormService.submit('tok', '1.2.3.4', undefined, {
        values: { email: 'jane@acme.com' },
      }),
    )

    expect(mockedFormSubmitted).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      form: expect.objectContaining({ id: 'f1', createdById: 'owner1' }),
    })
    expect(mockedLeadAssigned).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'seller1' }),
    )
  })

  it('should not double-notify the owner who also received the routed lead', async () => {
    routeTo('owner1')
    mockedLeadRepo.create.mockResolvedValue(
      ok(createFakeCrmLead({ id: 'lead1', ownerId: 'owner1' })),
    )

    expectOk(
      await CrmFormService.submit('tok', '1.2.3.4', undefined, {
        values: { email: 'jane@acme.com' },
      }),
    )

    expect(mockedLeadAssigned).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'owner1' }),
    )
    expect(mockedFormSubmitted).not.toHaveBeenCalled()
  })

  it('should notify the form owner for a non-lead form', async () => {
    mockedFormRepo.findPublishedByPublicToken.mockResolvedValue(
      ok(
        createFakeCrmForm({
          id: 'f2',
          action: 'COMPANY',
          workspaceId: 'ws1',
          createdById: 'owner1',
          fields: [
            {
              key: 'name',
              label: 'Empresa',
              type: 'text',
              required: true,
              mapping: { target: 'company', attribute: 'name' },
            },
          ] as never,
        }),
      ),
    )
    mockedCompanyRepo.create.mockResolvedValue(ok({ id: 'c1' } as never))

    expectOk(
      await CrmFormService.submit('tok', '1.2.3.4', undefined, {
        values: { name: 'Acme' },
      }),
    )

    expect(mockedFormSubmitted).toHaveBeenCalledWith(
      expect.objectContaining({ form: expect.objectContaining({ id: 'f2' }) }),
    )
  })
})

describe('CrmFormService.submit() server-side validation', () => {
  const fields = [
    {
      key: 'nome',
      label: 'Nome',
      type: 'text',
      required: true,
      mapping: { target: 'lead', attribute: 'name' },
    },
    {
      key: 'email',
      label: 'E-mail',
      type: 'email',
      required: true,
      mapping: { target: 'lead', attribute: 'email' },
    },
    {
      key: 'telefone',
      label: 'Telefone',
      type: 'phone',
      required: false,
      mapping: { target: 'lead', attribute: 'phone' },
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    mockLeadIntake()
    mockedModuleAccess.isEnabled.mockResolvedValue(ok(true))
    mockedFormRepo.findPublishedByPublicToken.mockResolvedValue(
      ok(leadForm(fields)),
    )
    mockedLeadRepo.create.mockResolvedValue(
      ok(createFakeCrmLead({ id: 'lead1', ownerId: 'owner1' })),
    )
    mockedSubmissionRepo.create.mockResolvedValue(
      ok(fakeSubmission('lead1') as never),
    )
  })

  it('should reject a submission missing required fields with field errors', async () => {
    const error = expectErr(
      await CrmFormService.submit('tok', '1.2.3.4', undefined, {
        values: { telefone: '11 99999-0000' },
      }),
      'VALIDATION_ERROR',
    )
    expect(error.details).toEqual([
      {
        code: 'custom',
        path: ['values', 'nome'],
        message: 'Campo obrigatório',
      },
      {
        code: 'custom',
        path: ['values', 'email'],
        message: 'Campo obrigatório',
      },
    ])
    expect(mockedLeadRepo.create).not.toHaveBeenCalled()
    expect(mockedSubmissionRepo.create).not.toHaveBeenCalled()
  })

  it('should reject a malformed e-mail and phone', async () => {
    const error = expectErr(
      await CrmFormService.submit('tok', '1.2.3.4', undefined, {
        values: { nome: 'Ana', email: 'ana@', telefone: 'abc' },
      }),
      'VALIDATION_ERROR',
    )
    expect(error.details).toEqual([
      { code: 'custom', path: ['values', 'email'], message: 'E-mail inválido' },
      {
        code: 'custom',
        path: ['values', 'telefone'],
        message: 'Telefone inválido',
      },
    ])
    expect(mockedSubmissionRepo.create).not.toHaveBeenCalled()
  })

  it('should store only the form fields, trimmed, and drop unknown keys', async () => {
    expectOk(
      await CrmFormService.submit('tok', '1.2.3.4', undefined, {
        values: {
          nome: '  Ana  ',
          email: 'ana@acme.com',
          is_admin: 'true',
        },
      }),
    )
    expect(mockedSubmissionRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        values: { nome: 'Ana', email: 'ana@acme.com' },
      }),
    )
    expect(mockedLeadRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Ana' }),
    )
  })
})
