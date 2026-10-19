export type AiPiiMaskingPolicyDTO = 'OFF' | 'AUTO_REPLIES' | 'EVERYWHERE'

/** Steel AI guardrails of a workspace (ADR 0041). */
export interface WorkspaceAiGuardrailsDTO {
  workspaceId: string
  /** What is masked before a call leaves for the provider. */
  piiMaskingPolicy: AiPiiMaskingPolicyDTO
  /** Ambiguous third-party text is checked by a cheap model too. */
  injectionClassifierEnabled: boolean
  /** Auto-replies hand off when the customer or the draft touches these. */
  forbiddenTopics: string[]
  /** Authority limits of the auto-replies (null = no limit, 0 = never). */
  maxDiscountPercent: number | null
  /** In BRL. */
  maxRefundAmount: number | null
  maxDeadlineDays: number | null
  /** Null while the workspace still runs on the defaults. */
  updatedAt: string | null
  /** The current user may change them (OWNER/ADMIN). */
  canManage: boolean
}
