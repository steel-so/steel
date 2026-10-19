import type { AiPiiMaskingPolicy, AiUsageFeature } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  type AutoReplyLimitHit,
  evaluateAutoReplyLimits,
  PROMPT_INJECTION_HANDOFF_NOTE,
} from '@/src/lib/ai/guardrails/limits'
import { ok, type Result } from '@/src/lib/result'
import {
  type EffectiveAiGuardrails,
  toEffectiveAiGuardrails,
  toWorkspaceAiGuardrailsDTO,
} from '@/src/mappers/ai-guardrails.mapper'
import { WorkspaceAiGuardrailsRepository } from '@/src/repositories/ai-guardrails.repository'
import type { UpdateWorkspaceAiGuardrailsDTO } from '@/src/schemas/ai-guardrails.schema'
import type { WorkspaceAiGuardrailsDTO } from '@/types/ai-guardrails'
import type { PreparedAiCall } from './ai-usage.service'
import { assertMember, assertPrivileged } from './authz'

/**
 * Unattended replies to third parties: where `AUTO_REPLIES` masks, and
 * where the forbidden topics and the authority limits apply.
 */
export const AI_AUTO_REPLY_FEATURES = new Set<AiUsageFeature>([
  'WHATSAPP_REPLY',
  'SERVICEDESK_PRE_SERVICE',
])

/** Whether the masking policy covers calls of this feature. */
export function shouldMaskPii(
  policy: AiPiiMaskingPolicy,
  feature: AiUsageFeature,
): boolean {
  if (policy === 'EVERYWHERE') return true
  if (policy === 'AUTO_REPLIES') return AI_AUTO_REPLY_FEATURES.has(feature)
  return false
}

/**
 * Final check of an auto-reply draft before it goes to the customer (ADR
 * 0041): a prompt injection detected during the call, a forbidden topic in
 * the customer's text or the draft, or a promise beyond the authority
 * limits. On a hit the caller hands off to a human with `note` and calls
 * `reportAutoReplyGuardrailHit`.
 */
export function checkAutoReplyGuardrails(
  call: Pick<PreparedAiCall, 'guard' | 'guardrails'>,
  input: { inbound: string; reply: string },
): AutoReplyLimitHit | null {
  if (call.guard?.tainted()) {
    return { kind: 'prompt_injection', note: PROMPT_INJECTION_HANDOFF_NOTE }
  }
  if (!call.guardrails) return null
  return evaluateAutoReplyLimits(call.guardrails.limits, input)
}

/** Log + audit of a guardrail hit (kind only, never the texts). */
export function reportAutoReplyGuardrailHit(input: {
  workspaceId: string
  feature: AiUsageFeature
  kind: AutoReplyLimitHit['kind']
  targetType: 'whatsapp_conversation' | 'sd_ai_conversation' | 'sd_ticket'
  targetId: string
}): void {
  logger.warn('ai.auto_reply_guardrail_hit', {
    component: 'AiGuardrails',
    workspaceId: input.workspaceId,
    feature: input.feature,
    kind: input.kind,
    targetType: input.targetType,
    targetId: input.targetId,
  })
  auditMutation({
    entity: 'ai_guardrail',
    action: 'escalate',
    actorId: null,
    targetId: input.targetId,
    meta: {
      workspaceId: input.workspaceId,
      feature: input.feature,
      kind: input.kind,
      targetType: input.targetType,
      actor: 'system',
    },
  })
}

/**
 * Steel AI guardrails (ADR 0041): personal-data masking policy, the
 * prompt-injection classifier switch and the limits of the auto-replies.
 * Members read (the page shows what is in force); only OWNER/ADMIN change.
 */
export const AiGuardrailsService = {
  /** Guardrails in force for a workspace. System path: no authorization. */
  async loadEffective(
    workspaceId: string,
  ): Promise<Result<EffectiveAiGuardrails>> {
    const row =
      await WorkspaceAiGuardrailsRepository.findByWorkspace(workspaceId)
    if (!row.ok) return row
    return ok(toEffectiveAiGuardrails(row.value))
  },

  async get(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WorkspaceAiGuardrailsDTO>> {
    const membership = await assertMember(actorId, workspaceId)
    if (!membership.ok) return membership
    const row =
      await WorkspaceAiGuardrailsRepository.findByWorkspace(workspaceId)
    if (!row.ok) return row
    return ok(
      toWorkspaceAiGuardrailsDTO({
        workspaceId,
        row: row.value,
        canManage: membership.value.isPrivileged,
      }),
    )
  },

  async update(
    actorId: string,
    workspaceId: string,
    dto: UpdateWorkspaceAiGuardrailsDTO,
  ): Promise<Result<WorkspaceAiGuardrailsDTO>> {
    const privileged = await assertPrivileged(actorId, workspaceId)
    if (!privileged.ok) return privileged

    const current =
      await WorkspaceAiGuardrailsRepository.findByWorkspace(workspaceId)
    if (!current.ok) return current
    const before = toEffectiveAiGuardrails(current.value)

    const next: EffectiveAiGuardrails = {
      piiMaskingPolicy: dto.piiMaskingPolicy ?? before.piiMaskingPolicy,
      injectionClassifierEnabled:
        dto.injectionClassifierEnabled ?? before.injectionClassifierEnabled,
      limits: {
        forbiddenTopics: dto.forbiddenTopics ?? before.limits.forbiddenTopics,
        maxDiscountPercent:
          dto.maxDiscountPercent !== undefined
            ? dto.maxDiscountPercent
            : before.limits.maxDiscountPercent,
        maxRefundAmount:
          dto.maxRefundAmount !== undefined
            ? dto.maxRefundAmount
            : before.limits.maxRefundAmount,
        maxDeadlineDays:
          dto.maxDeadlineDays !== undefined
            ? dto.maxDeadlineDays
            : before.limits.maxDeadlineDays,
      },
    }

    const saved = await WorkspaceAiGuardrailsRepository.upsert(workspaceId, {
      piiMaskingPolicy: next.piiMaskingPolicy,
      injectionClassifierEnabled: next.injectionClassifierEnabled,
      forbiddenTopics: next.limits.forbiddenTopics,
      maxDiscountPercent: next.limits.maxDiscountPercent,
      maxRefundAmount: next.limits.maxRefundAmount,
      maxDeadlineDays: next.limits.maxDeadlineDays,
      updatedById: actorId,
    })
    if (!saved.ok) return saved

    auditMutation({
      entity: 'workspace_ai_guardrails',
      action: 'update',
      actorId,
      targetId: saved.value.id,
      meta: {
        workspaceId,
        piiMaskingPolicy: next.piiMaskingPolicy,
        previousPiiMaskingPolicy: before.piiMaskingPolicy,
        injectionClassifierEnabled: next.injectionClassifierEnabled,
        // Counts and limits only: the topics are the workspace's own words.
        forbiddenTopics: next.limits.forbiddenTopics.length,
        maxDiscountPercent: next.limits.maxDiscountPercent,
        maxRefundAmount: next.limits.maxRefundAmount,
        maxDeadlineDays: next.limits.maxDeadlineDays,
      },
    })

    return ok(
      toWorkspaceAiGuardrailsDTO({
        workspaceId,
        row: saved.value,
        canManage: true,
      }),
    )
  },
}
