import type { AiUsageFeature, ModuleKind } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import {
  aiFeedbackNotFound,
  aiFeedbackTargetNotFound,
} from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'
import { toAiFeedbackDTO } from '@/src/mappers/ai-feedback.mapper'
import { AiFeedbackRepository } from '@/src/repositories/ai-feedback.repository'
import type {
  ListMyAiFeedbackQuery,
  UpsertAiFeedbackInput,
} from '@/src/schemas/ai-feedback.schema'
import type { AiFeedbackDTO } from '@/types/ai-quality'
import { AiUsageService } from './ai-usage.service'
import { assertMember } from './authz'
import { SdAccess } from './sd-access'
import { WhatsAppConversationService } from './whatsapp-conversation.service'

const ENTITY = 'ai_feedback'

interface ResolvedTarget {
  modelKey: string | null
  module: ModuleKind | null
}

/** Model configured for a feature when the answer did not keep its own. */
async function configuredModel(
  workspaceId: string,
  feature: AiUsageFeature,
  actorId: string,
): Promise<string | null> {
  const resolved = await AiUsageService.resolveModel(
    workspaceId,
    feature,
    actorId,
  )
  return resolved.ok ? (resolved.value.model?.key ?? null) : null
}

function triageModel(aiTriage: unknown): string | null {
  if (aiTriage && typeof aiTriage === 'object' && 'model' in aiTriage) {
    const model = (aiTriage as { model?: unknown }).model
    return typeof model === 'string' ? model : null
  }
  return null
}

/**
 * Checks that the rated answer exists in the workspace and that the actor
 * can see it (the same rule as the surface's own screen), and resolves the
 * model that produced it.
 */
async function resolveTarget(
  actorId: string,
  workspaceId: string,
  input: Pick<UpsertAiFeedbackInput, 'surface' | 'targetId'>,
): Promise<Result<ResolvedTarget>> {
  const { surface, targetId } = input
  switch (surface) {
    case 'STEEL_AI_MESSAGE': {
      const message = await AiFeedbackRepository.findAssistantMessage(targetId)
      if (!message.ok) return message
      const row = message.value
      // Steel AI conversations are private to their user.
      if (
        row?.role !== 'ASSISTANT' ||
        row.conversationWorkspaceId !== workspaceId ||
        row.conversationUserId !== actorId
      ) {
        return err(aiFeedbackTargetNotFound())
      }
      return ok({ modelKey: row.modelKey, module: null })
    }
    case 'STEEL_AGENT_RUN': {
      const access = await assertMember(actorId, workspaceId, {
        resource: 'steel-agents',
        action: 'VIEW',
      })
      if (!access.ok) return access
      const run = await AiFeedbackRepository.findAgentRun(targetId, workspaceId)
      if (!run.ok) return run
      if (!run.value) return err(aiFeedbackTargetNotFound())
      return ok({ modelKey: run.value.modelKey, module: null })
    }
    case 'SD_COPILOT':
    case 'SD_TRIAGE': {
      const access = await SdAccess.requireAgent(actorId, workspaceId, {
        resource: 'sd-tickets',
        action: 'VIEW',
      })
      if (!access.ok) return access
      const ticket = await AiFeedbackRepository.findTicket(
        targetId,
        workspaceId,
      )
      if (!ticket.ok) return ticket
      if (!ticket.value) return err(aiFeedbackTargetNotFound())
      if (surface === 'SD_TRIAGE') {
        if (!ticket.value.aiTriage) return err(aiFeedbackTargetNotFound())
        return ok({
          modelKey: triageModel(ticket.value.aiTriage),
          module: 'SERVICE_DESK',
        })
      }
      return ok({
        modelKey: await configuredModel(
          workspaceId,
          'SERVICEDESK_COPILOT',
          actorId,
        ),
        module: 'SERVICE_DESK',
      })
    }
    case 'SD_KCS_DRAFT': {
      const access = await SdAccess.requireAgent(actorId, workspaceId)
      if (!access.ok) return access
      const article = await AiFeedbackRepository.findKbDraft(
        targetId,
        workspaceId,
      )
      if (!article.ok) return article
      if (!article.value?.sourceTicketId) {
        return err(aiFeedbackTargetNotFound())
      }
      return ok({
        modelKey: await configuredModel(
          workspaceId,
          'SERVICEDESK_COPILOT',
          actorId,
        ),
        module: 'SERVICE_DESK',
      })
    }
    default: {
      const message = await AiFeedbackRepository.findWhatsAppMessage(
        targetId,
        workspaceId,
      )
      if (!message.ok) return message
      if (!message.value?.sentByAi || message.value.direction !== 'OUT') {
        return err(aiFeedbackTargetNotFound())
      }
      // Same visibility as the conversation (module, team, assignee).
      const conversation = await WhatsAppConversationService.get(
        actorId,
        workspaceId,
        message.value.conversationId,
      )
      if (!conversation.ok) return conversation
      return ok({
        modelKey: await configuredModel(workspaceId, 'WHATSAPP_REPLY', actorId),
        module: 'COMMUNICATION',
      })
    }
  }
}

/**
 * Thumbs up/down on AI answers (ADR 0039). Any member rates what they can
 * see; a rating is personal (one per answer, replaced on a new rating) and
 * only its author removes it.
 */
export const AiFeedbackService = {
  async rate(
    actorId: string,
    workspaceId: string,
    input: UpsertAiFeedbackInput,
  ): Promise<Result<AiFeedbackDTO>> {
    const membership = await assertMember(actorId, workspaceId)
    if (!membership.ok) return membership

    const target = await resolveTarget(actorId, workspaceId, input)
    if (!target.ok) return target

    const saved = await AiFeedbackRepository.upsert({
      workspaceId,
      userId: actorId,
      surface: input.surface,
      targetId: input.targetId,
      variant: input.variant,
      rating: input.rating,
      reason: input.rating === 'DOWN' ? input.reason : null,
      comment: input.comment,
      modelKey: target.value.modelKey,
      module: target.value.module,
    })
    if (!saved.ok) return saved

    // The comment may carry personal data: never logged.
    auditMutation({
      entity: ENTITY,
      action:
        saved.value.createdAt.getTime() === saved.value.updatedAt.getTime()
          ? 'create'
          : 'update',
      actorId,
      targetId: saved.value.id,
      meta: {
        workspaceId,
        surface: input.surface,
        rating: input.rating,
        reason: saved.value.reason,
        hasComment: Boolean(input.comment),
      },
    })
    logger.info(
      'ai.feedback_saved',
      logFields(
        { component: 'AiFeedbackService', workspaceId },
        {
          surface: input.surface,
          rating: input.rating,
          modelKey: target.value.modelKey,
        },
      ),
    )
    return ok(toAiFeedbackDTO(saved.value))
  },

  /** The actor's own ratings of a batch of answers (to paint the buttons). */
  async listMine(
    actorId: string,
    workspaceId: string,
    query: ListMyAiFeedbackQuery,
  ): Promise<Result<AiFeedbackDTO[]>> {
    const membership = await assertMember(actorId, workspaceId)
    if (!membership.ok) return membership
    const rows = await AiFeedbackRepository.listMine(
      actorId,
      workspaceId,
      query.surface,
      query.targetIds,
    )
    if (!rows.ok) return rows
    return ok(rows.value.map(toAiFeedbackDTO))
  },

  /** Undo: only the author removes their rating. */
  async remove(
    actorId: string,
    workspaceId: string,
    feedbackId: string,
  ): Promise<Result<void>> {
    const membership = await assertMember(actorId, workspaceId)
    if (!membership.ok) return membership
    const found = await AiFeedbackRepository.findById(feedbackId, workspaceId)
    if (!found.ok) return found
    if (!found.value || found.value.userId !== actorId) {
      return err(aiFeedbackNotFound())
    }
    const deleted = await AiFeedbackRepository.delete(feedbackId)
    if (!deleted.ok) return deleted
    auditMutation({
      entity: ENTITY,
      action: 'delete',
      actorId,
      targetId: feedbackId,
      meta: { workspaceId, surface: found.value.surface },
    })
    return ok(undefined)
  },
}
