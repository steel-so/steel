import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeCrmCustomFieldDefinition } from '@/src/__tests__/factories/crm-custom-field.factory'
import {
  createFakeCrmOpportunity,
  createFakeCrmOpportunityLineItem,
} from '@/src/__tests__/factories/crm-opportunity.factory'
import {
  createFakeCrmPipeline,
  createFakeCrmPipelineStage,
} from '@/src/__tests__/factories/crm-pipeline.factory'
import { createFakeCrmProduct } from '@/src/__tests__/factories/crm-product.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, notFound } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/services/crm-notifications')
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-opportunity.repository')
vi.mock('@/src/repositories/crm-pipeline.repository')
vi.mock('@/src/repositories/crm-activity.repository')
vi.mock('@/src/repositories/crm-custom-field.repository')
vi.mock('@/src/repositories/crm-product.repository')
vi.mock('@/src/services/crm-workflow-dispatcher', () => ({
  dispatchCrmWorkflowRecordEvent: vi.fn(async () => undefined),
}))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))

import { auditMutation } from '@/lib/axiom/audit'
import { CrmActivityRepository } from '@/src/repositories/crm-activity.repository'
import {
  CrmCustomFieldDefinitionRepository,
  CrmCustomFieldValueRepository,
} from '@/src/repositories/crm-custom-field.repository'
import {
  CrmOpportunityLineItemRepository,
  CrmOpportunityRepository,
} from '@/src/repositories/crm-opportunity.repository'
import {
  CrmPipelineRepository,
  CrmPipelineStageRepository,
} from '@/src/repositories/crm-pipeline.repository'
import { CrmProductRepository } from '@/src/repositories/crm-product.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { dispatchCrmWorkflowRecordEvent } from '@/src/services/crm-workflow-dispatcher'
import { notifyCrmOpportunityAssigned } from '../crm-notifications'
import {
  CrmOpportunityLineItemService,
  CrmOpportunityService,
} from '../crm-opportunity.service'

const mockedMembershipRepo = vi.mocked(MembershipRepository)
const mockedOpportunityRepo = vi.mocked(CrmOpportunityRepository)
const mockedLineItemRepo = vi.mocked(CrmOpportunityLineItemRepository)
const mockedCustomFieldValueRepo = vi.mocked(CrmCustomFieldValueRepository)

mockedCustomFieldValueRepo.listByRecords.mockResolvedValue(ok([]))
const mockedPipelineRepo = vi.mocked(CrmPipelineRepository)
const mockedStageRepo = vi.mocked(CrmPipelineStageRepository)
const mockedActivityRepo = vi.mocked(CrmActivityRepository)
const mockedProductRepo = vi.mocked(CrmProductRepository)
const mockedDefinitionRepo = vi.mocked(CrmCustomFieldDefinitionRepository)
const mockedModuleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const mockedDispatch = vi.mocked(dispatchCrmWorkflowRecordEvent)
const mockedAudit = vi.mocked(auditMutation)

describe('CrmOpportunityService', () => {
  describe('list()', () => {
    it('should return opportunities for a workspace member', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      mockedOpportunityRepo.listByWorkspace.mockResolvedValue(
        ok([createFakeCrmOpportunity({ workspaceId: 'ws1' })]),
      )

      const dtos = expectOk(await CrmOpportunityService.list('u1', 'ws1', {}))
      expect(dtos).toHaveLength(1)
    })

    it('should return FORBIDDEN for a non-member', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))

      expectErr(await CrmOpportunityService.list('u1', 'ws1', {}), 'FORBIDDEN')
    })
  })

  describe('create()', () => {
    beforeEach(() => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
    })

    it('should resolve the workspace default pipeline/stage when both are omitted', async () => {
      mockedPipelineRepo.findDefault.mockResolvedValue(
        ok(createFakeCrmPipeline({ id: 'pl-default' })),
      )
      mockedStageRepo.listByPipeline.mockResolvedValue(
        ok([createFakeCrmPipelineStage({ id: 's1', category: 'OPEN' })]),
      )
      mockedOpportunityRepo.create.mockResolvedValue(
        ok(
          createFakeCrmOpportunity({
            pipelineId: 'pl-default',
            stageId: 's1',
          }),
        ),
      )

      expectOk(
        await CrmOpportunityService.create('u1', 'ws1', { name: 'Negócio' }),
      )
      expect(mockedOpportunityRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ pipelineId: 'pl-default', stageId: 's1' }),
      )
      expect(mockedActivityRepo.record).toHaveBeenCalledWith(
        expect.objectContaining({ entity: 'opportunity', action: 'CREATED' }),
      )
    })

    it('should resolve the first stage when only pipelineId is given', async () => {
      mockedPipelineRepo.findById.mockResolvedValue(
        ok(createFakeCrmPipeline({ id: 'pl1' })),
      )
      mockedStageRepo.listByPipeline.mockResolvedValue(
        ok([createFakeCrmPipelineStage({ id: 's1', category: 'OPEN' })]),
      )
      mockedOpportunityRepo.create.mockResolvedValue(
        ok(createFakeCrmOpportunity({ pipelineId: 'pl1', stageId: 's1' })),
      )

      expectOk(
        await CrmOpportunityService.create('u1', 'ws1', {
          name: 'Negócio',
          pipelineId: 'pl1',
        }),
      )
      expect(mockedOpportunityRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ pipelineId: 'pl1', stageId: 's1' }),
      )
    })

    it('should validate stageId belongs to pipelineId when both are given', async () => {
      mockedPipelineRepo.findById.mockResolvedValue(
        ok(createFakeCrmPipeline({ id: 'pl1' })),
      )
      mockedStageRepo.findById.mockResolvedValue(
        ok(createFakeCrmPipelineStage({ id: 's2' })),
      )
      mockedOpportunityRepo.create.mockResolvedValue(
        ok(createFakeCrmOpportunity({ pipelineId: 'pl1', stageId: 's2' })),
      )

      expectOk(
        await CrmOpportunityService.create('u1', 'ws1', {
          name: 'Negócio',
          pipelineId: 'pl1',
          stageId: 's2',
        }),
      )
      expect(mockedOpportunityRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ pipelineId: 'pl1', stageId: 's2' }),
      )
    })

    it('should return BAD_REQUEST when stageId is given without pipelineId', async () => {
      expectErr(
        await CrmOpportunityService.create('u1', 'ws1', {
          name: 'Negócio',
          stageId: 's1',
        }),
        'BAD_REQUEST',
      )
      expect(mockedOpportunityRepo.create).not.toHaveBeenCalled()
    })
  })

  describe('update()', () => {
    beforeEach(() => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
    })

    it('should keep the current pipeline/stage when neither is given', async () => {
      mockedOpportunityRepo.findById.mockResolvedValue(
        ok(
          createFakeCrmOpportunity({
            id: 'op1',
            pipelineId: 'pl1',
            stageId: 's1',
          }),
        ),
      )
      mockedOpportunityRepo.update.mockResolvedValue(
        ok(
          createFakeCrmOpportunity({
            id: 'op1',
            pipelineId: 'pl1',
            stageId: 's1',
          }),
        ),
      )

      expectOk(
        await CrmOpportunityService.update('u1', 'ws1', 'op1', {
          name: 'Renomeado',
        }),
      )
      expect(mockedOpportunityRepo.update).toHaveBeenCalledWith(
        'op1',
        expect.objectContaining({
          pipelineId: undefined,
          stageId: undefined,
        }),
      )
    })

    it('should stamp stageChangedAt when the stage really changes', async () => {
      mockedOpportunityRepo.findById.mockResolvedValue(
        ok(
          createFakeCrmOpportunity({
            id: 'op1',
            pipelineId: 'pl1',
            stageId: 's1',
          }),
        ),
      )
      mockedPipelineRepo.findById.mockResolvedValue(
        ok(createFakeCrmPipeline({ id: 'pl1' })),
      )
      mockedStageRepo.listByPipeline.mockResolvedValue(
        ok([
          createFakeCrmPipelineStage({ id: 's1', category: 'OPEN' }),
          createFakeCrmPipelineStage({ id: 's2', category: 'OPEN' }),
        ]),
      )
      mockedOpportunityRepo.update.mockResolvedValue(
        ok(createFakeCrmOpportunity({ id: 'op1', stageId: 's2' })),
      )

      expectOk(
        await CrmOpportunityService.update('u1', 'ws1', 'op1', {
          stageId: 's2',
        }),
      )
      expect(mockedOpportunityRepo.update).toHaveBeenCalledWith(
        'op1',
        expect.objectContaining({ stageChangedAt: expect.any(Date) }),
      )

      mockedOpportunityRepo.update.mockClear()
      expectOk(
        await CrmOpportunityService.update('u1', 'ws1', 'op1', {
          stageId: 's1',
        }),
      )
      expect(
        mockedOpportunityRepo.update.mock.calls[0]?.[1],
      ).not.toHaveProperty('stageChangedAt')
    })

    it('should stamp contactChangedAt only when an existing contact is replaced', async () => {
      mockedOpportunityRepo.findById.mockResolvedValue(
        ok(
          createFakeCrmOpportunity({
            id: 'op1',
            pointOfContactId: 'p1',
          }),
        ),
      )
      mockedOpportunityRepo.update.mockResolvedValue(
        ok(createFakeCrmOpportunity({ id: 'op1', pointOfContactId: 'p2' })),
      )

      expectOk(
        await CrmOpportunityService.update('u1', 'ws1', 'op1', {
          pointOfContactId: 'p2',
        }),
      )
      expect(mockedOpportunityRepo.update).toHaveBeenCalledWith(
        'op1',
        expect.objectContaining({ contactChangedAt: expect.any(Date) }),
      )

      mockedOpportunityRepo.update.mockClear()
      expectOk(
        await CrmOpportunityService.update('u1', 'ws1', 'op1', {
          pointOfContactId: 'p1',
        }),
      )
      expect(
        mockedOpportunityRepo.update.mock.calls[0]?.[1],
      ).not.toHaveProperty('contactChangedAt')
    })

    it('should resolve the first stage of the new pipeline when only pipelineId changes', async () => {
      mockedOpportunityRepo.findById.mockResolvedValue(
        ok(
          createFakeCrmOpportunity({
            id: 'op1',
            pipelineId: 'pl1',
            stageId: 's1',
          }),
        ),
      )
      mockedPipelineRepo.findById.mockResolvedValue(
        ok(createFakeCrmPipeline({ id: 'pl2' })),
      )
      mockedStageRepo.listByPipeline.mockResolvedValue(
        ok([createFakeCrmPipelineStage({ id: 's9', category: 'OPEN' })]),
      )
      mockedOpportunityRepo.update.mockResolvedValue(
        ok(
          createFakeCrmOpportunity({
            id: 'op1',
            pipelineId: 'pl2',
            stageId: 's9',
          }),
        ),
      )

      expectOk(
        await CrmOpportunityService.update('u1', 'ws1', 'op1', {
          pipelineId: 'pl2',
        }),
      )
      expect(mockedOpportunityRepo.update).toHaveBeenCalledWith(
        'op1',
        expect.objectContaining({ pipelineId: 'pl2', stageId: 's9' }),
      )
    })
  })
})

describe('CrmOpportunityLineItemService', () => {
  describe('create()', () => {
    it('should create a line item when the opportunity exists', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      mockedOpportunityRepo.findById.mockResolvedValue(
        ok(createFakeCrmOpportunity({ id: 'op1' })),
      )
      mockedLineItemRepo.create.mockResolvedValue(
        ok(createFakeCrmOpportunityLineItem({ name: 'Licença' })),
      )

      const dto = expectOk(
        await CrmOpportunityLineItemService.create('u1', 'ws1', 'op1', {
          name: 'Licença',
          quantity: 1,
          unitPrice: 0,
          discountPct: 0,
          billingType: 'ONE_TIME',
        }),
      )
      expect(dto.name).toBe('Licença')
    })
  })

  describe('update()', () => {
    function arrange() {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      mockedOpportunityRepo.findById.mockResolvedValue(
        ok(createFakeCrmOpportunity({ id: 'op1' })),
      )
      mockedLineItemRepo.findById.mockResolvedValue(
        ok(
          createFakeCrmOpportunityLineItem({
            id: 'li1',
            opportunityId: 'op1',
            productId: null,
          }),
        ),
      )
      mockedLineItemRepo.update.mockResolvedValue(
        ok(createFakeCrmOpportunityLineItem({ id: 'li1' })),
      )
    }

    it('should switch the product in place, copying its snapshot', async () => {
      arrange()
      mockedProductRepo.findById.mockResolvedValue(
        ok(
          createFakeCrmProduct({
            id: 'prod1',
            name: 'Plano Pro',
            unitPrice: 250 as never,
            billingType: 'MONTHLY',
          }),
        ),
      )

      expectOk(
        await CrmOpportunityLineItemService.update('u1', 'ws1', 'op1', 'li1', {
          productId: 'prod1',
        }),
      )

      expect(mockedProductRepo.findById).toHaveBeenCalledWith('prod1', 'ws1')
      expect(mockedLineItemRepo.update).toHaveBeenCalledWith('li1', {
        productId: 'prod1',
        name: 'Plano Pro',
        unitPrice: 250,
        billingType: 'MONTHLY',
      })
      expect(mockedLineItemRepo.delete).not.toHaveBeenCalled()
      expect(mockedLineItemRepo.create).not.toHaveBeenCalled()
    })

    it('should reject a product from another workspace without touching the item', async () => {
      arrange()
      mockedProductRepo.findById.mockResolvedValue(err(notFound('CrmProduct')))

      expectErr(
        await CrmOpportunityLineItemService.update('u1', 'ws1', 'op1', 'li1', {
          productId: 'other',
        }),
        'RESOURCE_NOT_FOUND',
      )
      expect(mockedLineItemRepo.update).not.toHaveBeenCalled()
    })

    it('should detach the product when productId is null', async () => {
      arrange()

      expectOk(
        await CrmOpportunityLineItemService.update('u1', 'ws1', 'op1', 'li1', {
          productId: null,
        }),
      )

      expect(mockedProductRepo.findById).not.toHaveBeenCalled()
      expect(mockedLineItemRepo.update).toHaveBeenCalledWith('li1', {
        productId: null,
      })
    })
  })
})

describe('CrmOpportunityService — authz, errors and edge branches', () => {
  const dbErr = () => err(databaseError())
  const nf = () => err(notFound('Oportunidade'))
  const asRole = (role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER') =>
    mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership({ role })),
    )

  beforeEach(() => {
    mockedCustomFieldValueRepo.listByRecords.mockResolvedValue(ok([]))
    mockedCustomFieldValueRepo.applyForRecord.mockResolvedValue(
      ok(undefined as never),
    )
  })

  describe('list() / getById()', () => {
    it('should return MODULE_DISABLED when the CRM module is off', async () => {
      asRole('OWNER')
      mockedModuleAccess.isEnabled.mockResolvedValueOnce(ok(false))
      expectErr(
        await CrmOpportunityService.list('u1', 'ws1', {}),
        'MODULE_DISABLED',
      )
      expect(mockedOpportunityRepo.listByWorkspace).not.toHaveBeenCalled()
    })

    it('should forward the filters and merge custom fields in the list', async () => {
      asRole('VIEWER')
      const opp = createFakeCrmOpportunity({ id: 'op1' })
      mockedOpportunityRepo.listByWorkspace.mockResolvedValue(ok([opp]))
      mockedCustomFieldValueRepo.listByRecords.mockResolvedValue(
        ok([{ recordId: 'op1', definitionId: 'd1', value: 'x' } as never]),
      )
      const list = expectOk(
        await CrmOpportunityService.list('u1', 'ws1', { stageId: 's1' }),
      )
      expect(mockedOpportunityRepo.listByWorkspace).toHaveBeenCalledWith(
        'ws1',
        { stageId: 's1' },
      )
      expect(list[0]?.customFields).toEqual({ cf_d1: 'x' })
    })

    it('should propagate list repository errors', async () => {
      asRole('MEMBER')
      mockedOpportunityRepo.listByWorkspace.mockResolvedValue(dbErr())
      expectErr(
        await CrmOpportunityService.list('u1', 'ws1', {}),
        'DATABASE_ERROR',
      )
    })

    it('should return an opportunity by id for a VIEWER', async () => {
      asRole('VIEWER')
      mockedOpportunityRepo.findById.mockResolvedValue(
        ok(createFakeCrmOpportunity({ id: 'op1' })),
      )
      const dto = expectOk(
        await CrmOpportunityService.getById('u1', 'ws1', 'op1'),
      )
      expect(dto.id).toBe('op1')
      expect(dto.customFields).toEqual({})
    })

    it('should deny getById for a non-member and propagate NOT_FOUND', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValueOnce(
        ok(null),
      )
      expectErr(
        await CrmOpportunityService.getById('u1', 'ws1', 'op1'),
        'FORBIDDEN',
      )
      asRole('MEMBER')
      mockedOpportunityRepo.findById.mockResolvedValue(nf())
      expectErr(
        await CrmOpportunityService.getById('u1', 'ws1', 'op1'),
        'RESOURCE_NOT_FOUND',
      )
    })
  })

  describe('create()', () => {
    const arrangeStage = () => {
      mockedPipelineRepo.findById.mockResolvedValue(
        ok(createFakeCrmPipeline({ id: 'pl1' })),
      )
      mockedStageRepo.findById.mockResolvedValue(
        ok(createFakeCrmPipelineStage({ id: 's1' })),
      )
    }
    const dto = { name: 'Negócio', pipelineId: 'pl1', stageId: 's1' }

    it('should deny a VIEWER', async () => {
      asRole('VIEWER')
      expectErr(
        await CrmOpportunityService.create('u1', 'ws1', dto),
        'FORBIDDEN',
      )
      expect(mockedOpportunityRepo.create).not.toHaveBeenCalled()
    })

    it('should reject a pipeline from another workspace', async () => {
      asRole('MEMBER')
      mockedPipelineRepo.findById.mockResolvedValue(err(notFound('Pipeline')))
      expectErr(
        await CrmOpportunityService.create('u1', 'ws1', dto),
        'RESOURCE_NOT_FOUND',
      )
    })

    it('should reject a stage that does not belong to the pipeline', async () => {
      asRole('MEMBER')
      mockedPipelineRepo.findById.mockResolvedValue(
        ok(createFakeCrmPipeline({ id: 'pl1' })),
      )
      mockedStageRepo.findById.mockResolvedValue(err(notFound('Etapa')))
      expectErr(
        await CrmOpportunityService.create('u1', 'ws1', dto),
        'RESOURCE_NOT_FOUND',
      )
      expect(mockedOpportunityRepo.create).not.toHaveBeenCalled()
    })

    it('should propagate pipeline errors when resolving the first stage', async () => {
      asRole('MEMBER')
      mockedPipelineRepo.findById.mockResolvedValue(err(notFound('Pipeline')))
      expectErr(
        await CrmOpportunityService.create('u1', 'ws1', {
          name: 'N',
          pipelineId: 'pl1',
        }),
        'RESOURCE_NOT_FOUND',
      )
    })

    it('should propagate stage listing errors', async () => {
      asRole('MEMBER')
      mockedPipelineRepo.findById.mockResolvedValue(
        ok(createFakeCrmPipeline({ id: 'pl1' })),
      )
      mockedStageRepo.listByPipeline.mockResolvedValue(dbErr())
      expectErr(
        await CrmOpportunityService.create('u1', 'ws1', {
          name: 'N',
          pipelineId: 'pl1',
        }),
        'DATABASE_ERROR',
      )
    })

    it('should fail when the pipeline has no stages', async () => {
      asRole('MEMBER')
      mockedPipelineRepo.findById.mockResolvedValue(
        ok(createFakeCrmPipeline({ id: 'pl1' })),
      )
      mockedStageRepo.listByPipeline.mockResolvedValue(ok([]))
      expectErr(
        await CrmOpportunityService.create('u1', 'ws1', {
          name: 'N',
          pipelineId: 'pl1',
        }),
        'CRM_PIPELINE_NOT_FOUND',
      )
    })

    it('should fall back to the first stage by position when none is OPEN', async () => {
      asRole('MEMBER')
      mockedPipelineRepo.findById.mockResolvedValue(
        ok(createFakeCrmPipeline({ id: 'pl1' })),
      )
      mockedStageRepo.listByPipeline.mockResolvedValue(
        ok([
          createFakeCrmPipelineStage({
            id: 's-late',
            position: 2,
            category: 'WON',
          }),
          createFakeCrmPipelineStage({
            id: 's-first',
            position: 0,
            category: 'LOST',
          }),
        ]),
      )
      mockedOpportunityRepo.create.mockResolvedValue(
        ok(createFakeCrmOpportunity({ id: 'op1' })),
      )
      expectOk(
        await CrmOpportunityService.create('u1', 'ws1', {
          name: 'N',
          pipelineId: 'pl1',
        }),
      )
      expect(mockedOpportunityRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ stageId: 's-first' }),
      )
    })

    it('should audit a failed creation', async () => {
      asRole('MEMBER')
      arrangeStage()
      mockedOpportunityRepo.create.mockResolvedValue(dbErr())
      expectErr(
        await CrmOpportunityService.create('u1', 'ws1', dto),
        'DATABASE_ERROR',
      )
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: 'failure',
          reason: 'DATABASE_ERROR',
        }),
      )
      expect(mockedDispatch).not.toHaveBeenCalled()
    })

    it('should apply custom fields and dispatch the created event', async () => {
      asRole('MEMBER')
      arrangeStage()
      mockedOpportunityRepo.create.mockResolvedValue(
        ok(createFakeCrmOpportunity({ id: 'op1' })),
      )
      mockedDefinitionRepo.listByWorkspace.mockResolvedValue(
        ok([createFakeCrmCustomFieldDefinition({ id: 'd1', type: 'TEXT' })]),
      )
      expectOk(
        await CrmOpportunityService.create('u1', 'ws1', {
          ...dto,
          customFields: { d1: 'valor' },
        }),
      )
      expect(mockedCustomFieldValueRepo.applyForRecord).toHaveBeenCalledWith([
        { definitionId: 'd1', recordId: 'op1', value: 'valor' },
      ])
      expect(mockedDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ entity: 'opportunity', event: 'created' }),
      )
    })

    it('should return invalid custom field values', async () => {
      asRole('MEMBER')
      arrangeStage()
      mockedOpportunityRepo.create.mockResolvedValue(
        ok(createFakeCrmOpportunity({ id: 'op1' })),
      )
      mockedDefinitionRepo.listByWorkspace.mockResolvedValue(
        ok([createFakeCrmCustomFieldDefinition({ id: 'd1', type: 'NUMBER' })]),
      )
      expectErr(
        await CrmOpportunityService.create('u1', 'ws1', {
          ...dto,
          customFields: { d1: 'abc' },
        }),
        'CRM_CUSTOM_FIELD_INVALID',
      )
    })

    it('should propagate custom field loading errors', async () => {
      asRole('MEMBER')
      arrangeStage()
      mockedOpportunityRepo.create.mockResolvedValue(
        ok(createFakeCrmOpportunity({ id: 'op1' })),
      )
      mockedCustomFieldValueRepo.listByRecords.mockResolvedValue(dbErr())
      expectErr(
        await CrmOpportunityService.create('u1', 'ws1', dto),
        'DATABASE_ERROR',
      )
    })
  })

  describe('update()', () => {
    const existing = () =>
      createFakeCrmOpportunity({ id: 'op1', pipelineId: 'pl1', stageId: 's1' })

    it('should deny a VIEWER', async () => {
      asRole('VIEWER')
      expectErr(
        await CrmOpportunityService.update('u1', 'ws1', 'op1', { name: 'x' }),
        'FORBIDDEN',
      )
    })

    it('should propagate NOT_FOUND', async () => {
      asRole('MEMBER')
      mockedOpportunityRepo.findById.mockResolvedValue(nf())
      expectErr(
        await CrmOpportunityService.update('u1', 'ws1', 'op1', { name: 'x' }),
        'RESOURCE_NOT_FOUND',
      )
    })

    it('should validate a new stage against the current pipeline', async () => {
      asRole('MEMBER')
      mockedOpportunityRepo.findById.mockResolvedValue(ok(existing()))
      mockedPipelineRepo.findById.mockResolvedValue(
        ok(createFakeCrmPipeline({ id: 'pl1' })),
      )
      mockedStageRepo.findById.mockResolvedValue(
        ok(createFakeCrmPipelineStage({ id: 's2' })),
      )
      mockedOpportunityRepo.update.mockResolvedValue(ok(existing()))
      expectOk(
        await CrmOpportunityService.update('u1', 'ws1', 'op1', {
          stageId: 's2',
        }),
      )
      expect(mockedStageRepo.findById).toHaveBeenCalledWith('s2', 'pl1')
      expect(mockedOpportunityRepo.update).toHaveBeenCalledWith(
        'op1',
        expect.objectContaining({ pipelineId: 'pl1', stageId: 's2' }),
      )
    })

    it('should reject an invalid stage', async () => {
      asRole('MEMBER')
      mockedOpportunityRepo.findById.mockResolvedValue(ok(existing()))
      mockedPipelineRepo.findById.mockResolvedValue(
        ok(createFakeCrmPipeline({ id: 'pl1' })),
      )
      mockedStageRepo.findById.mockResolvedValue(err(notFound('Etapa')))
      expectErr(
        await CrmOpportunityService.update('u1', 'ws1', 'op1', {
          stageId: 'zz',
        }),
        'RESOURCE_NOT_FOUND',
      )
      expect(mockedOpportunityRepo.update).not.toHaveBeenCalled()
    })

    it('should propagate errors resolving the first stage of a new pipeline', async () => {
      asRole('MEMBER')
      mockedOpportunityRepo.findById.mockResolvedValue(ok(existing()))
      mockedPipelineRepo.findById.mockResolvedValue(err(notFound('Pipeline')))
      expectErr(
        await CrmOpportunityService.update('u1', 'ws1', 'op1', {
          pipelineId: 'pl9',
        }),
        'RESOURCE_NOT_FOUND',
      )
    })

    it('should propagate update errors without auditing', async () => {
      asRole('MEMBER')
      mockedOpportunityRepo.findById.mockResolvedValue(ok(existing()))
      mockedOpportunityRepo.update.mockResolvedValue(dbErr())
      expectErr(
        await CrmOpportunityService.update('u1', 'ws1', 'op1', { name: 'x' }),
        'DATABASE_ERROR',
      )
      expect(mockedAudit).not.toHaveBeenCalled()
    })

    it('should apply custom fields, record activity and dispatch the event', async () => {
      asRole('MEMBER')
      mockedOpportunityRepo.findById.mockResolvedValue(ok(existing()))
      mockedOpportunityRepo.update.mockResolvedValue(ok(existing()))
      mockedDefinitionRepo.listByWorkspace.mockResolvedValue(
        ok([createFakeCrmCustomFieldDefinition({ id: 'd1', type: 'TEXT' })]),
      )
      expectOk(
        await CrmOpportunityService.update('u1', 'ws1', 'op1', {
          customFields: { d1: 'v' },
        }),
      )
      expect(mockedCustomFieldValueRepo.applyForRecord).toHaveBeenCalled()
      expect(mockedActivityRepo.record).toHaveBeenCalledWith(
        expect.objectContaining({ entity: 'opportunity', action: 'UPDATED' }),
      )
      expect(mockedDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'updated' }),
      )
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({ meta: { fields: ['customFields'] } }),
      )
    })

    it('should propagate custom field errors on update', async () => {
      asRole('MEMBER')
      mockedOpportunityRepo.findById.mockResolvedValue(ok(existing()))
      mockedOpportunityRepo.update.mockResolvedValue(ok(existing()))
      mockedDefinitionRepo.listByWorkspace.mockResolvedValue(dbErr())
      expectErr(
        await CrmOpportunityService.update('u1', 'ws1', 'op1', {
          customFields: { d1: 'v' },
        }),
        'DATABASE_ERROR',
      )
    })

    it('should propagate custom field loading errors on update', async () => {
      asRole('MEMBER')
      mockedOpportunityRepo.findById.mockResolvedValue(ok(existing()))
      mockedOpportunityRepo.update.mockResolvedValue(ok(existing()))
      mockedCustomFieldValueRepo.listByRecords.mockResolvedValue(dbErr())
      expectErr(
        await CrmOpportunityService.update('u1', 'ws1', 'op1', { name: 'x' }),
        'DATABASE_ERROR',
      )
    })
  })

  describe('remove()', () => {
    it('should deny a MEMBER (members cannot delete opportunities)', async () => {
      asRole('MEMBER')
      expectErr(
        await CrmOpportunityService.remove('u1', 'ws1', 'op1'),
        'FORBIDDEN',
      )
      expect(mockedOpportunityRepo.softDelete).not.toHaveBeenCalled()
    })

    it('should deny a VIEWER', async () => {
      asRole('VIEWER')
      expectErr(
        await CrmOpportunityService.remove('u1', 'ws1', 'op1'),
        'FORBIDDEN',
      )
    })

    it('should soft delete for an ADMIN, audit, record and dispatch', async () => {
      asRole('ADMIN')
      mockedOpportunityRepo.findById.mockResolvedValue(
        ok(createFakeCrmOpportunity({ id: 'op1' })),
      )
      mockedOpportunityRepo.softDelete.mockResolvedValue(ok(undefined as never))
      expectOk(await CrmOpportunityService.remove('u1', 'ws1', 'op1'))
      expect(mockedOpportunityRepo.softDelete).toHaveBeenCalledWith('op1')
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'delete', targetId: 'op1' }),
      )
      expect(mockedActivityRepo.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DELETED' }),
      )
      expect(mockedDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'deleted' }),
      )
    })

    it('should propagate NOT_FOUND and soft delete errors', async () => {
      asRole('OWNER')
      mockedOpportunityRepo.findById.mockResolvedValueOnce(nf())
      expectErr(
        await CrmOpportunityService.remove('u1', 'ws1', 'op1'),
        'RESOURCE_NOT_FOUND',
      )
      mockedOpportunityRepo.findById.mockResolvedValue(
        ok(createFakeCrmOpportunity({ id: 'op1' })),
      )
      mockedOpportunityRepo.softDelete.mockResolvedValue(dbErr())
      expectErr(
        await CrmOpportunityService.remove('u1', 'ws1', 'op1'),
        'DATABASE_ERROR',
      )
    })
  })

  describe('reorder()', () => {
    it('should reorder within a stage and across the workspace for a MEMBER', async () => {
      asRole('MEMBER')
      mockedOpportunityRepo.reorderInStage.mockResolvedValue(ok(undefined))
      mockedOpportunityRepo.reorder.mockResolvedValue(ok(undefined))
      expectOk(
        await CrmOpportunityService.reorderInStage('u1', 'ws1', 's1', ['a']),
      )
      expectOk(await CrmOpportunityService.reorder('u1', 'ws1', ['a', 'b']))
      expect(mockedOpportunityRepo.reorderInStage).toHaveBeenCalledWith('s1', [
        'a',
      ])
      expect(mockedOpportunityRepo.reorder).toHaveBeenCalledWith('ws1', [
        'a',
        'b',
      ])
    })

    it('should deny a VIEWER', async () => {
      asRole('VIEWER')
      expectErr(
        await CrmOpportunityService.reorderInStage('u1', 'ws1', 's1', []),
        'FORBIDDEN',
      )
      expectErr(
        await CrmOpportunityService.reorder('u1', 'ws1', []),
        'FORBIDDEN',
      )
    })
  })
})

describe('CrmOpportunityLineItemService — authz, errors and edge branches', () => {
  const dbErr = () => err(databaseError())
  const nf = () => err(notFound('Oportunidade'))
  const asRole = (role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER') =>
    mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership({ role })),
    )
  const item = {
    name: 'Licença',
    quantity: 1,
    unitPrice: 10,
    discountPct: 0,
    billingType: 'ONE_TIME' as const,
  }

  describe('list()', () => {
    it('should list line items for a VIEWER', async () => {
      asRole('VIEWER')
      mockedOpportunityRepo.findById.mockResolvedValue(
        ok(createFakeCrmOpportunity({ id: 'op1' })),
      )
      mockedLineItemRepo.listByOpportunity.mockResolvedValue(
        ok([createFakeCrmOpportunityLineItem({ id: 'li1' })]),
      )
      const list = expectOk(
        await CrmOpportunityLineItemService.list('u1', 'ws1', 'op1'),
      )
      expect(list.map((i) => i.id)).toEqual(['li1'])
    })

    it('should deny a non-member', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
      expectErr(
        await CrmOpportunityLineItemService.list('u1', 'ws1', 'op1'),
        'FORBIDDEN',
      )
    })

    it('should propagate NOT_FOUND and listing errors', async () => {
      asRole('MEMBER')
      mockedOpportunityRepo.findById.mockResolvedValueOnce(nf())
      expectErr(
        await CrmOpportunityLineItemService.list('u1', 'ws1', 'op1'),
        'RESOURCE_NOT_FOUND',
      )
      mockedOpportunityRepo.findById.mockResolvedValue(
        ok(createFakeCrmOpportunity({ id: 'op1' })),
      )
      mockedLineItemRepo.listByOpportunity.mockResolvedValue(dbErr())
      expectErr(
        await CrmOpportunityLineItemService.list('u1', 'ws1', 'op1'),
        'DATABASE_ERROR',
      )
    })
  })

  describe('create()', () => {
    it('should deny a VIEWER', async () => {
      asRole('VIEWER')
      expectErr(
        await CrmOpportunityLineItemService.create('u1', 'ws1', 'op1', item),
        'FORBIDDEN',
      )
    })

    it('should propagate a missing opportunity', async () => {
      asRole('MEMBER')
      mockedOpportunityRepo.findById.mockResolvedValue(nf())
      expectErr(
        await CrmOpportunityLineItemService.create('u1', 'ws1', 'op1', item),
        'RESOURCE_NOT_FOUND',
      )
      expect(mockedLineItemRepo.create).not.toHaveBeenCalled()
    })

    it('should audit a failed creation', async () => {
      asRole('MEMBER')
      mockedOpportunityRepo.findById.mockResolvedValue(
        ok(createFakeCrmOpportunity({ id: 'op1' })),
      )
      mockedLineItemRepo.create.mockResolvedValue(dbErr())
      expectErr(
        await CrmOpportunityLineItemService.create('u1', 'ws1', 'op1', item),
        'DATABASE_ERROR',
      )
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'crm_opportunity_line_item',
          outcome: 'failure',
        }),
      )
    })
  })

  describe('update()', () => {
    const arrange = (productId: string | null = 'prod1') => {
      asRole('MEMBER')
      mockedOpportunityRepo.findById.mockResolvedValue(
        ok(createFakeCrmOpportunity({ id: 'op1' })),
      )
      mockedLineItemRepo.findById.mockResolvedValue(
        ok(createFakeCrmOpportunityLineItem({ id: 'li1', productId })),
      )
      mockedLineItemRepo.update.mockResolvedValue(
        ok(createFakeCrmOpportunityLineItem({ id: 'li1' })),
      )
    }

    it('should deny a VIEWER', async () => {
      asRole('VIEWER')
      expectErr(
        await CrmOpportunityLineItemService.update('u1', 'ws1', 'op1', 'li1', {
          quantity: 2,
        }),
        'FORBIDDEN',
      )
    })

    it('should propagate a missing opportunity or line item', async () => {
      asRole('MEMBER')
      mockedOpportunityRepo.findById.mockResolvedValueOnce(nf())
      expectErr(
        await CrmOpportunityLineItemService.update('u1', 'ws1', 'op1', 'li1', {
          quantity: 2,
        }),
        'RESOURCE_NOT_FOUND',
      )
      mockedOpportunityRepo.findById.mockResolvedValue(
        ok(createFakeCrmOpportunity({ id: 'op1' })),
      )
      mockedLineItemRepo.findById.mockResolvedValue(err(notFound('Item')))
      expectErr(
        await CrmOpportunityLineItemService.update('u1', 'ws1', 'op1', 'li1', {
          quantity: 2,
        }),
        'RESOURCE_NOT_FOUND',
      )
    })

    it('should not reload the product when it did not change', async () => {
      arrange('prod1')
      expectOk(
        await CrmOpportunityLineItemService.update('u1', 'ws1', 'op1', 'li1', {
          productId: 'prod1',
          quantity: 3,
        }),
      )
      expect(mockedProductRepo.findById).not.toHaveBeenCalled()
      expect(mockedLineItemRepo.update).toHaveBeenCalledWith('li1', {
        productId: 'prod1',
        quantity: 3,
      })
    })

    it('should keep client-provided fields when switching the product', async () => {
      arrange(null)
      mockedProductRepo.findById.mockResolvedValue(
        ok(
          createFakeCrmProduct({
            id: 'prod2',
            name: 'Produto',
            unitPrice: 99 as never,
            billingType: 'MONTHLY',
          }),
        ),
      )
      expectOk(
        await CrmOpportunityLineItemService.update('u1', 'ws1', 'op1', 'li1', {
          productId: 'prod2',
          name: 'Nome próprio',
          unitPrice: 5,
          billingType: 'YEARLY',
        }),
      )
      expect(mockedLineItemRepo.update).toHaveBeenCalledWith('li1', {
        productId: 'prod2',
        name: 'Nome próprio',
        unitPrice: 5,
        billingType: 'YEARLY',
      })
    })

    it('should propagate update errors', async () => {
      arrange()
      mockedLineItemRepo.update.mockResolvedValue(dbErr())
      expectErr(
        await CrmOpportunityLineItemService.update('u1', 'ws1', 'op1', 'li1', {
          quantity: 2,
        }),
        'DATABASE_ERROR',
      )
      expect(mockedAudit).not.toHaveBeenCalled()
    })
  })

  describe('remove()', () => {
    it('should deny a MEMBER (members cannot delete)', async () => {
      asRole('MEMBER')
      expectErr(
        await CrmOpportunityLineItemService.remove('u1', 'ws1', 'op1', 'li1'),
        'FORBIDDEN',
      )
      expect(mockedLineItemRepo.delete).not.toHaveBeenCalled()
    })

    it('should delete for an ADMIN and audit', async () => {
      asRole('ADMIN')
      mockedOpportunityRepo.findById.mockResolvedValue(
        ok(createFakeCrmOpportunity({ id: 'op1' })),
      )
      mockedLineItemRepo.findById.mockResolvedValue(
        ok(createFakeCrmOpportunityLineItem({ id: 'li1' })),
      )
      mockedLineItemRepo.delete.mockResolvedValue(ok(undefined as never))
      expectOk(
        await CrmOpportunityLineItemService.remove('u1', 'ws1', 'op1', 'li1'),
      )
      expect(mockedLineItemRepo.delete).toHaveBeenCalledWith('li1')
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'delete', targetId: 'li1' }),
      )
    })

    it('should propagate missing records and delete errors', async () => {
      asRole('OWNER')
      mockedOpportunityRepo.findById.mockResolvedValueOnce(nf())
      expectErr(
        await CrmOpportunityLineItemService.remove('u1', 'ws1', 'op1', 'li1'),
        'RESOURCE_NOT_FOUND',
      )

      mockedOpportunityRepo.findById.mockResolvedValue(
        ok(createFakeCrmOpportunity({ id: 'op1' })),
      )
      mockedLineItemRepo.findById.mockResolvedValueOnce(err(notFound('Item')))
      expectErr(
        await CrmOpportunityLineItemService.remove('u1', 'ws1', 'op1', 'li1'),
        'RESOURCE_NOT_FOUND',
      )

      mockedLineItemRepo.findById.mockResolvedValue(
        ok(createFakeCrmOpportunityLineItem({ id: 'li1' })),
      )
      mockedLineItemRepo.delete.mockResolvedValue(dbErr())
      expectErr(
        await CrmOpportunityLineItemService.remove('u1', 'ws1', 'op1', 'li1'),
        'DATABASE_ERROR',
      )
    })
  })
})

describe('CrmOpportunityService.update() notifications', () => {
  const mockedAssigned = vi.mocked(notifyCrmOpportunityAssigned)

  beforeEach(() => {
    vi.clearAllMocks()
    mockedCustomFieldValueRepo.listByRecords.mockResolvedValue(ok([]))
    mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership({ role: 'MEMBER' })),
    )
  })

  it('should notify the new owner when the owner changes', async () => {
    mockedOpportunityRepo.findById.mockResolvedValue(
      ok(createFakeCrmOpportunity({ id: 'op1', ownerId: 'old' })),
    )
    const updated = createFakeCrmOpportunity({ id: 'op1', ownerId: 'u2' })
    mockedOpportunityRepo.update.mockResolvedValue(ok(updated))

    expectOk(
      await CrmOpportunityService.update('u1', 'ws1', 'op1', { ownerId: 'u2' }),
    )

    expect(mockedAssigned).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      opportunity: updated,
      ownerId: 'u2',
      actorId: 'u1',
    })
  })

  it('should not notify when the owner stays the same', async () => {
    const same = createFakeCrmOpportunity({ id: 'op1', ownerId: 'u2' })
    mockedOpportunityRepo.findById.mockResolvedValue(ok(same))
    mockedOpportunityRepo.update.mockResolvedValue(ok(same))

    expectOk(
      await CrmOpportunityService.update('u1', 'ws1', 'op1', { name: 'X' }),
    )

    expect(mockedAssigned).not.toHaveBeenCalled()
  })
})
