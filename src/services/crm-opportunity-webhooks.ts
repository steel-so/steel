import type { CrmOpportunity, CrmPipelineStage } from '@prisma/client'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import {
  type CrmStageRef,
  crmOpportunityDealData,
  crmOpportunityStageChangedData,
} from '@/src/lib/webhooks/payloads'
import { CrmPipelineStageRepository } from '@/src/repositories/crm-pipeline.repository'
import { emitWebhookEvent } from './webhook-emitter'

/**
 * Outbound webhooks of an opportunity that changed stage (ADR 0036):
 * `crm.opportunity.stage_changed` always, plus `crm.deal.won`/`crm.deal.lost`
 * when it entered a WON/LOST stage. Fire-and-forget: loads both stages,
 * never throws.
 */

function stageRef(stage: CrmPipelineStage): CrmStageRef {
  return { id: stage.id, name: stage.name, category: stage.category }
}

export async function emitCrmOpportunityStageWebhooks(input: {
  workspaceId: string
  before: Pick<CrmOpportunity, 'stageId' | 'pipelineId'>
  after: CrmOpportunity
  actorId: string | null
}): Promise<void> {
  const { workspaceId, before, after, actorId } = input
  if (before.stageId === after.stageId) return
  try {
    const [from, to] = await Promise.all([
      CrmPipelineStageRepository.findById(before.stageId, before.pipelineId),
      CrmPipelineStageRepository.findById(after.stageId, after.pipelineId),
    ])
    if (!to.ok) {
      logger.warn(
        'webhooks.crm_stage_lookup_failed',
        logFields(
          { component: 'CrmOpportunityWebhooks', workspaceId },
          { opportunityId: after.id, reason: to.error.code },
        ),
      )
      return
    }
    const fromStage = from.ok ? stageRef(from.value) : null
    const toStage = stageRef(to.value)

    await emitWebhookEvent(
      workspaceId,
      'crm.opportunity.stage_changed',
      crmOpportunityStageChangedData({
        opportunity: after,
        fromStage,
        toStage,
        actorId,
      }),
    )
    if (
      (toStage.category === 'WON' || toStage.category === 'LOST') &&
      fromStage?.category !== toStage.category
    ) {
      await emitWebhookEvent(
        workspaceId,
        toStage.category === 'WON' ? 'crm.deal.won' : 'crm.deal.lost',
        crmOpportunityDealData({ opportunity: after, actorId }),
      )
    }
  } catch (cause) {
    logger.warn(
      'webhooks.crm_stage_emit_failed',
      logFields(
        { component: 'CrmOpportunityWebhooks', workspaceId },
        {
          opportunityId: after.id,
          message: cause instanceof Error ? cause.message : String(cause),
        },
      ),
    )
  }
}
