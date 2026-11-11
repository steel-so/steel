import { logger } from '@/lib/axiom/logger'
import { formatDocumentMoney } from '@/src/lib/documents/format'
import { CrmNoteRepository } from '@/src/repositories/crm-note.repository'
import { CrmOpportunityRepository } from '@/src/repositories/crm-opportunity.repository'
import { CrmPipelineStageRepository } from '@/src/repositories/crm-pipeline.repository'
import { emitCrmOpportunityStageWebhooks } from './crm-opportunity-webhooks'

/**
 * An accepted proposal moves its opportunity to the first WON stage of the
 * pipeline and leaves a note on it, as the paid charge of the legacy
 * proposals does (C6). Never throws and never fails the accept: the answer
 * is already recorded, so any problem here is only logged.
 */
export async function advanceOpportunityOnAccept(input: {
  workspaceId: string
  opportunityId: string
  documentTitle: string
  acceptedByName: string
  totalValue: number | null
  /** Note author: the document owner. */
  authorId: string
}): Promise<{ won: boolean }> {
  try {
    const opportunity = await CrmOpportunityRepository.findById(
      input.opportunityId,
      input.workspaceId,
    )
    if (!opportunity.ok) return { won: false }
    const deal = opportunity.value

    const stages = await CrmPipelineStageRepository.listByPipeline(
      deal.pipelineId,
    )
    const list = stages.ok ? stages.value : []
    const current = list.find((stage) => stage.id === deal.stageId)
    const target = list.find((stage) => stage.category === 'WON')

    let won = current?.category === 'WON'
    if (!won && target) {
      const now = new Date()
      const moved = await CrmOpportunityRepository.update(deal.id, {
        stageId: target.id,
        wonAt: deal.wonAt ?? now,
        stageChangedAt: now,
      })
      if (moved.ok) {
        won = true
        void emitCrmOpportunityStageWebhooks({
          workspaceId: input.workspaceId,
          before: deal,
          after: moved.value,
          actorId: null,
        })
      } else {
        logger.warn('documents.accept.win_failed', {
          opportunityId: deal.id,
          code: moved.error.code,
        })
      }
    }

    const total =
      input.totalValue && input.totalValue > 0
        ? ` Total aceito: ${formatDocumentMoney(input.totalValue)}.`
        : ''
    const note = await CrmNoteRepository.create({
      workspaceId: input.workspaceId,
      createdById: input.authorId,
      opportunityId: deal.id,
      title: 'Proposta aceita',
      body: `${input.acceptedByName} aceitou o documento "${input.documentTitle}" pelo link.${total}`,
    })
    if (!note.ok) {
      logger.warn('documents.accept.note_failed', {
        opportunityId: deal.id,
        code: note.error.code,
      })
    }
    return { won }
  } catch (error) {
    logger.error('documents.accept.crm_sync_failed', {
      opportunityId: input.opportunityId,
      message: error instanceof Error ? error.message : String(error),
    })
    return { won: false }
  }
}
