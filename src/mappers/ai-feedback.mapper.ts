import type { AiFeedback } from '@prisma/client'
import type { AiFeedbackReason } from '@/src/lib/ai/quality-labels'
import type { AiFeedbackDTO } from '@/types/ai-quality'

export function toAiFeedbackDTO(row: AiFeedback): AiFeedbackDTO {
  return {
    id: row.id,
    surface: row.surface,
    targetId: row.targetId,
    variant: row.variant,
    rating: row.rating,
    reason: row.reason as AiFeedbackReason | null,
    comment: row.comment,
    modelKey: row.modelKey,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
