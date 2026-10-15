import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeCrmOpportunity } from '@/src/__tests__/factories/crm-opportunity.factory'
import {
  createFakeCrmPipeline,
  createFakeCrmPipelineStage,
} from '@/src/__tests__/factories/crm-pipeline.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectOk } from '@/src/__tests__/helpers/result.helpers'
import { ok } from '@/src/lib/result'

vi.mock('@/src/services/crm-notifications')
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-opportunity.repository')
vi.mock('@/src/repositories/crm-pipeline.repository')
vi.mock('@/src/repositories/crm-activity.repository')
vi.mock('@/src/repositories/crm-custom-field.repository')
vi.mock('@/src/services/crm-workflow-dispatcher', () => ({
  dispatchCrmWorkflowRecordEvent: vi.fn(async () => undefined),
}))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))

import { CrmCustomFieldValueRepository } from '@/src/repositories/crm-custom-field.repository'
import { CrmOpportunityRepository } from '@/src/repositories/crm-opportunity.repository'
import {
  CrmPipelineRepository,
  CrmPipelineStageRepository,
} from '@/src/repositories/crm-pipeline.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { CrmOpportunityService } from '../crm-opportunity.service'

const memberships = vi.mocked(MembershipRepository)
const opportunities = vi.mocked(CrmOpportunityRepository)
const pipelines = vi.mocked(CrmPipelineRepository)
const stages = vi.mocked(CrmPipelineStageRepository)
const customValues = vi.mocked(CrmCustomFieldValueRepository)

const WON_STAGE = createFakeCrmPipelineStage({
  id: 's-won',
  pipelineId: 'pl1',
  category: 'WON',
})
const OPEN_STAGE = createFakeCrmPipelineStage({
  id: 's-open',
  pipelineId: 'pl1',
  category: 'OPEN',
})

beforeEach(() => {
  memberships.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'MEMBER' })),
  )
  customValues.listByRecords.mockResolvedValue(ok([]))
  pipelines.findById.mockResolvedValue(ok(createFakeCrmPipeline({ id: 'pl1' })))
  opportunities.create.mockResolvedValue(ok(createFakeCrmOpportunity()))
  opportunities.update.mockResolvedValue(ok(createFakeCrmOpportunity()))
})

function lastCreate() {
  return opportunities.create.mock.calls.at(-1)?.[0]
}
function lastUpdate() {
  return opportunities.update.mock.calls.at(-1)?.[1]
}

describe('wonAt on create', () => {
  it('stamps a deal created straight in a WON stage', async () => {
    stages.findById.mockResolvedValue(ok(WON_STAGE))
    expectOk(
      await CrmOpportunityService.create('u1', 'ws1', {
        name: 'Fechado',
        pipelineId: 'pl1',
        stageId: 's-won',
      }),
    )
    expect(lastCreate()?.wonAt).toBeInstanceOf(Date)
  })

  it('leaves an open deal without wonAt', async () => {
    stages.findById.mockResolvedValue(ok(OPEN_STAGE))
    expectOk(
      await CrmOpportunityService.create('u1', 'ws1', {
        name: 'Aberto',
        pipelineId: 'pl1',
        stageId: 's-open',
      }),
    )
    expect(lastCreate()).not.toHaveProperty('wonAt')
  })

  it('stamps when the first stage of the pipeline is a WON one', async () => {
    stages.listByPipeline.mockResolvedValue(ok([WON_STAGE]))
    expectOk(
      await CrmOpportunityService.create('u1', 'ws1', {
        name: 'Só ganho',
        pipelineId: 'pl1',
      }),
    )
    expect(lastCreate()?.wonAt).toBeInstanceOf(Date)
  })
})

describe('wonAt on update', () => {
  it('stamps a deal that moves into a WON stage', async () => {
    opportunities.findById.mockResolvedValue(
      ok(createFakeCrmOpportunity({ pipelineId: 'pl1', wonAt: null })),
    )
    stages.findById.mockResolvedValue(ok(WON_STAGE))
    expectOk(
      await CrmOpportunityService.update('u1', 'ws1', 'op1', {
        stageId: 's-won',
      }),
    )
    expect(lastUpdate()?.wonAt).toBeInstanceOf(Date)
  })

  it('keeps the original date when a won deal moves to another WON stage', async () => {
    const wonAt = new Date('2026-10-01T15:00:00.000Z')
    opportunities.findById.mockResolvedValue(
      ok(createFakeCrmOpportunity({ pipelineId: 'pl1', wonAt })),
    )
    stages.findById.mockResolvedValue(ok(WON_STAGE))
    expectOk(
      await CrmOpportunityService.update('u1', 'ws1', 'op1', {
        stageId: 's-won',
      }),
    )
    expect(lastUpdate()?.wonAt).toBe(wonAt)
  })

  it('clears the date when a won deal is reopened', async () => {
    opportunities.findById.mockResolvedValue(
      ok(createFakeCrmOpportunity({ pipelineId: 'pl1', wonAt: new Date() })),
    )
    stages.findById.mockResolvedValue(ok(OPEN_STAGE))
    expectOk(
      await CrmOpportunityService.update('u1', 'ws1', 'op1', {
        stageId: 's-open',
      }),
    )
    expect(lastUpdate()?.wonAt).toBeNull()
  })

  it('leaves wonAt alone between open stages and without a stage change', async () => {
    opportunities.findById.mockResolvedValue(
      ok(createFakeCrmOpportunity({ pipelineId: 'pl1', wonAt: null })),
    )
    stages.findById.mockResolvedValue(ok(OPEN_STAGE))
    expectOk(
      await CrmOpportunityService.update('u1', 'ws1', 'op1', {
        stageId: 's-open',
      }),
    )
    expect(lastUpdate()).not.toHaveProperty('wonAt')

    expectOk(
      await CrmOpportunityService.update('u1', 'ws1', 'op1', { name: 'X' }),
    )
    expect(lastUpdate()).not.toHaveProperty('wonAt')
  })

  it('follows the first stage when only the pipeline changes', async () => {
    opportunities.findById.mockResolvedValue(
      ok(createFakeCrmOpportunity({ pipelineId: 'pl0', wonAt: null })),
    )
    stages.listByPipeline.mockResolvedValue(ok([OPEN_STAGE]))
    expectOk(
      await CrmOpportunityService.update('u1', 'ws1', 'op1', {
        pipelineId: 'pl1',
      }),
    )
    expect(lastUpdate()).toMatchObject({ pipelineId: 'pl1', stageId: 's-open' })
    expect(lastUpdate()).not.toHaveProperty('wonAt')
  })
})
