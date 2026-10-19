import type { AiPiiMaskingPolicy, WorkspaceAiGuardrails } from '@prisma/client'
import type { AutoReplyLimits } from '@/src/lib/ai/guardrails/limits'
import type { WorkspaceAiGuardrailsDTO } from '@/types/ai-guardrails'

/** Guardrails in force: the saved row or, without one, the defaults. */
export interface EffectiveAiGuardrails {
  piiMaskingPolicy: AiPiiMaskingPolicy
  injectionClassifierEnabled: boolean
  limits: AutoReplyLimits
}

export const DEFAULT_AI_GUARDRAILS: EffectiveAiGuardrails = {
  piiMaskingPolicy: 'AUTO_REPLIES',
  injectionClassifierEnabled: false,
  limits: {
    forbiddenTopics: [],
    maxDiscountPercent: null,
    maxRefundAmount: null,
    maxDeadlineDays: null,
  },
}

export function toEffectiveAiGuardrails(
  row: WorkspaceAiGuardrails | null,
): EffectiveAiGuardrails {
  if (!row) {
    return {
      ...DEFAULT_AI_GUARDRAILS,
      limits: { ...DEFAULT_AI_GUARDRAILS.limits, forbiddenTopics: [] },
    }
  }
  return {
    piiMaskingPolicy: row.piiMaskingPolicy,
    injectionClassifierEnabled: row.injectionClassifierEnabled,
    limits: {
      forbiddenTopics: row.forbiddenTopics,
      maxDiscountPercent: row.maxDiscountPercent,
      maxRefundAmount: row.maxRefundAmount?.toNumber() ?? null,
      maxDeadlineDays: row.maxDeadlineDays,
    },
  }
}

export function toWorkspaceAiGuardrailsDTO(input: {
  workspaceId: string
  row: WorkspaceAiGuardrails | null
  canManage: boolean
}): WorkspaceAiGuardrailsDTO {
  const effective = toEffectiveAiGuardrails(input.row)
  return {
    workspaceId: input.workspaceId,
    piiMaskingPolicy: effective.piiMaskingPolicy,
    injectionClassifierEnabled: effective.injectionClassifierEnabled,
    forbiddenTopics: effective.limits.forbiddenTopics,
    maxDiscountPercent: effective.limits.maxDiscountPercent,
    maxRefundAmount: effective.limits.maxRefundAmount,
    maxDeadlineDays: effective.limits.maxDeadlineDays,
    updatedAt: input.row?.updatedAt.toISOString() ?? null,
    canManage: input.canManage,
  }
}
