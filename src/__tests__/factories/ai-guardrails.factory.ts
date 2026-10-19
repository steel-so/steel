import { createId } from '@paralleldrive/cuid2'
import type { WorkspaceAiGuardrails } from '@prisma/client'

export function createFakeWorkspaceAiGuardrails(
  overrides?: Partial<WorkspaceAiGuardrails>,
): WorkspaceAiGuardrails {
  const now = new Date('2026-10-18T12:00:00Z')
  return {
    id: createId(),
    workspaceId: createId(),
    piiMaskingPolicy: 'AUTO_REPLIES',
    injectionClassifierEnabled: false,
    forbiddenTopics: [],
    maxDiscountPercent: null,
    maxRefundAmount: null,
    maxDeadlineDays: null,
    updatedById: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}
