import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/repositories/crm-pipeline.repository')

import { logger } from '@/lib/axiom/logger'
import { createFakeCrmOpportunity } from '@/src/__tests__/factories/crm-opportunity.factory'
import { createFakeCrmPipelineStage } from '@/src/__tests__/factories/crm-pipeline.factory'
import { databaseError, notFound } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import { CrmPipelineStageRepository } from '@/src/repositories/crm-pipeline.repository'
import { emitCrmOpportunityStageWebhooks } from '../crm-opportunity-webhooks'
import { emitWebhookEvent } from '../webhook-emitter'

const stages = vi.mocked(CrmPipelineStageRepository)
const emit = vi.mocked(emitWebhookEvent)

const open = createFakeCrmPipelineStage({
  id: 's1',
  name: 'Proposta',
  category: 'OPEN',
})
const won = createFakeCrmPipelineStage({
  id: 's2',
  name: 'Ganho',
  category: 'WON',
})
const lost = createFakeCrmPipelineStage({
  id: 's3',
  name: 'Perdido',
  category: 'LOST',
})
const byId = { s1: open, s2: won, s3: lost } as Record<string, typeof open>

beforeEach(() => {
  stages.findById.mockImplementation(async (id) =>
    byId[id] ? ok(byId[id]) : err(notFound('CrmPipelineStage')),
  )
})

function moved(from: string, to: string) {
  return {
    workspaceId: 'w1',
    before: { stageId: from, pipelineId: 'p1' },
    after: createFakeCrmOpportunity({
      id: 'o1',
      stageId: to,
      pipelineId: 'p1',
    }),
    actorId: 'u1',
  }
}

describe('emitCrmOpportunityStageWebhooks', () => {
  it('should do nothing when the stage did not change', async () => {
    await emitCrmOpportunityStageWebhooks(moved('s1', 's1'))
    expect(stages.findById).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })

  it('should emit stage_changed for an OPEN → OPEN move', async () => {
    byId.s4 = createFakeCrmPipelineStage({
      id: 's4',
      name: 'Negociação',
      category: 'OPEN',
    })
    await emitCrmOpportunityStageWebhooks(moved('s1', 's4'))
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith(
      'w1',
      'crm.opportunity.stage_changed',
      expect.objectContaining({
        fromStage: { id: 's1', name: 'Proposta', category: 'OPEN' },
        toStage: { id: 's4', name: 'Negociação', category: 'OPEN' },
        actorId: 'u1',
      }),
    )
  })

  it('should also emit crm.deal.won / crm.deal.lost on entering those stages', async () => {
    await emitCrmOpportunityStageWebhooks(moved('s1', 's2'))
    expect(emit).toHaveBeenLastCalledWith(
      'w1',
      'crm.deal.won',
      expect.objectContaining({ source: 'opportunity', id: 'o1' }),
    )
    await emitCrmOpportunityStageWebhooks(moved('s2', 's3'))
    expect(emit).toHaveBeenLastCalledWith(
      'w1',
      'crm.deal.lost',
      expect.any(Object),
    )
  })

  it('should emit with fromStage null when the old stage is gone', async () => {
    await emitCrmOpportunityStageWebhooks(moved('gone', 's2'))
    expect(emit).toHaveBeenCalledWith(
      'w1',
      'crm.opportunity.stage_changed',
      expect.objectContaining({ fromStage: null }),
    )
  })

  it('should log and skip when the new stage cannot be read', async () => {
    stages.findById.mockResolvedValue(err(databaseError('x')))
    await emitCrmOpportunityStageWebhooks(moved('s1', 's2'))
    expect(emit).not.toHaveBeenCalled()
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      'webhooks.crm_stage_lookup_failed',
      expect.anything(),
    )
  })

  it('should never throw', async () => {
    stages.findById.mockRejectedValueOnce(new Error('boom'))
    await expect(
      emitCrmOpportunityStageWebhooks(moved('s1', 's2')),
    ).resolves.toBeUndefined()
    stages.findById.mockRejectedValueOnce('boom')
    await expect(
      emitCrmOpportunityStageWebhooks(moved('s1', 's2')),
    ).resolves.toBeUndefined()
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      'webhooks.crm_stage_emit_failed',
      expect.anything(),
    )
  })
})
