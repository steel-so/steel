import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseError, notFound } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))
vi.mock('@/src/repositories/crm-opportunity.repository')
vi.mock('@/src/repositories/crm-pipeline.repository')
vi.mock('@/src/repositories/crm-note.repository')
vi.mock('@/src/services/crm-opportunity-webhooks', () => ({
  emitCrmOpportunityStageWebhooks: vi.fn(async () => undefined),
}))

import { logger } from '@/lib/axiom/logger'
import { CrmNoteRepository } from '@/src/repositories/crm-note.repository'
import { CrmOpportunityRepository } from '@/src/repositories/crm-opportunity.repository'
import { CrmPipelineStageRepository } from '@/src/repositories/crm-pipeline.repository'
import { emitCrmOpportunityStageWebhooks } from '../crm-opportunity-webhooks'
import { advanceOpportunityOnAccept } from '../document-crm-sync'

const opportunityRepo = vi.mocked(CrmOpportunityRepository)
const stageRepo = vi.mocked(CrmPipelineStageRepository)
const noteRepo = vi.mocked(CrmNoteRepository)
const webhooks = vi.mocked(emitCrmOpportunityStageWebhooks)

const INPUT = {
  workspaceId: 'ws1',
  opportunityId: 'opp1',
  documentTitle: 'Proposta 2027',
  acceptedByName: 'Maria',
  totalValue: 2000,
  authorId: 'owner',
}

const deal = (stageId = 'open') =>
  ({
    id: 'opp1',
    pipelineId: 'p1',
    stageId,
    wonAt: null,
    createdById: 'u1',
  }) as never

const STAGES = [
  { id: 'open', category: 'OPEN' },
  { id: 'won', category: 'WON' },
] as never

beforeEach(() => {
  opportunityRepo.findById.mockResolvedValue(ok(deal()))
  stageRepo.listByPipeline.mockResolvedValue(ok(STAGES))
  opportunityRepo.update.mockResolvedValue(ok(deal('won')))
  noteRepo.create.mockResolvedValue(ok({} as never))
})

describe('advanceOpportunityOnAccept()', () => {
  it('moves the deal to the first WON stage and leaves a note', async () => {
    expect(await advanceOpportunityOnAccept(INPUT)).toEqual({ won: true })
    expect(opportunityRepo.update).toHaveBeenCalledWith(
      'opp1',
      expect.objectContaining({ stageId: 'won', wonAt: expect.any(Date) }),
    )
    expect(webhooks).toHaveBeenCalled()
    expect(noteRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        opportunityId: 'opp1',
        createdById: 'owner',
        title: 'Proposta aceita',
        body: expect.stringContaining('Total aceito: R$ 2.000,00'),
      }),
    )
  })

  it('keeps a deal already won and writes the note without a total', async () => {
    opportunityRepo.findById.mockResolvedValue(ok(deal('won')))
    expect(
      await advanceOpportunityOnAccept({ ...INPUT, totalValue: null }),
    ).toEqual({ won: true })
    expect(opportunityRepo.update).not.toHaveBeenCalled()
    expect(noteRepo.create.mock.calls[0][0].body).not.toContain('Total')
  })

  it('logs when the pipeline has no WON stage or the move fails', async () => {
    stageRepo.listByPipeline.mockResolvedValue(err(databaseError()))
    expect(await advanceOpportunityOnAccept(INPUT)).toEqual({ won: false })

    stageRepo.listByPipeline.mockResolvedValue(ok(STAGES))
    opportunityRepo.update.mockResolvedValue(err(databaseError()))
    noteRepo.create.mockResolvedValue(err(databaseError()))
    expect(await advanceOpportunityOnAccept(INPUT)).toEqual({ won: false })
    expect(logger.warn).toHaveBeenCalledWith(
      'documents.accept.win_failed',
      expect.any(Object),
    )
    expect(logger.warn).toHaveBeenCalledWith(
      'documents.accept.note_failed',
      expect.any(Object),
    )
  })

  it('does nothing for a missing deal and never throws', async () => {
    opportunityRepo.findById.mockResolvedValue(err(notFound('CrmOpportunity')))
    expect(await advanceOpportunityOnAccept(INPUT)).toEqual({ won: false })
    expect(noteRepo.create).not.toHaveBeenCalled()

    opportunityRepo.findById.mockRejectedValue(new Error('boom'))
    expect(await advanceOpportunityOnAccept(INPUT)).toEqual({ won: false })
    opportunityRepo.findById.mockRejectedValue('boom')
    expect(await advanceOpportunityOnAccept(INPUT)).toEqual({ won: false })
    expect(logger.error).toHaveBeenCalledWith(
      'documents.accept.crm_sync_failed',
      expect.any(Object),
    )
  })
})
