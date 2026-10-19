/**
 * Constants and pt-BR labels of the Steel AI quality features (ADR 0039):
 * feedback surfaces and reasons, eval targets. Isomorphic — used by the
 * schemas, the mappers, the CSV export and the UI.
 */

export const AI_FEEDBACK_SURFACES = [
  'STEEL_AI_MESSAGE',
  'STEEL_AGENT_RUN',
  'SD_COPILOT',
  'SD_TRIAGE',
  'SD_KCS_DRAFT',
  'WHATSAPP_AUTO_REPLY',
] as const
export type AiFeedbackSurfaceKey = (typeof AI_FEEDBACK_SURFACES)[number]

export const AI_FEEDBACK_SURFACE_LABELS: Record<AiFeedbackSurfaceKey, string> =
  {
    STEEL_AI_MESSAGE: 'Chat do Steel AI',
    STEEL_AGENT_RUN: 'Steel Agents',
    SD_COPILOT: 'Copiloto do ServiceDesk',
    SD_TRIAGE: 'Triagem do ServiceDesk',
    SD_KCS_DRAFT: 'Rascunho de artigo (KCS)',
    WHATSAPP_AUTO_REPLY: 'Resposta automática do WhatsApp',
  }

export const AI_FEEDBACK_RATINGS = ['UP', 'DOWN'] as const
export type AiFeedbackRatingKey = (typeof AI_FEEDBACK_RATINGS)[number]

/** Preset reasons offered with a thumbs down (optional). */
export const AI_FEEDBACK_REASONS = [
  'incorrect',
  'incomplete',
  'irrelevant',
  'tone',
  'unsafe',
  'other',
] as const
export type AiFeedbackReason = (typeof AI_FEEDBACK_REASONS)[number]

export const AI_FEEDBACK_REASON_LABELS: Record<AiFeedbackReason, string> = {
  incorrect: 'Informação errada',
  incomplete: 'Incompleta',
  irrelevant: 'Não respondeu o que pedi',
  tone: 'Tom inadequado',
  unsafe: 'Expôs dado ou fez algo indevido',
  other: 'Outro motivo',
}

/**
 * Sub-answers of the ServiceDesk copilot inside one ticket. `chat` may carry
 * the message index (`chat:3`).
 */
export const SD_COPILOT_VARIANTS = [
  'summary',
  'reply',
  'solution',
  'classification',
  'chat',
] as const
export type SdCopilotVariant = (typeof SD_COPILOT_VARIANTS)[number]

export const AI_EVAL_TARGETS = ['STEEL_ASSISTANT', 'WHATSAPP_REPLY'] as const
export type AiEvalTargetKey = (typeof AI_EVAL_TARGETS)[number]

export const AI_EVAL_TARGET_LABELS: Record<AiEvalTargetKey, string> = {
  STEEL_ASSISTANT: 'Steel AI (assistente)',
  WHATSAPP_REPLY: 'Resposta automática do WhatsApp',
}

export const AI_EVAL_RUN_REASONS = [
  'manual',
  'model_change',
  'prompt_change',
  'skill_change',
] as const
export type AiEvalRunReason = (typeof AI_EVAL_RUN_REASONS)[number]

export const AI_EVAL_RUN_REASON_LABELS: Record<AiEvalRunReason, string> = {
  manual: 'Manual',
  model_change: 'Antes de trocar o modelo',
  prompt_change: 'Antes de trocar o prompt',
  skill_change: 'Antes de alterar a skill',
}

/** Bounded cost: sets per workspace and cases per set. */
export const AI_EVAL_MAX_SETS = 20
export const AI_EVAL_MAX_CASES = 50
/** Max text checks of each kind per case. */
export const AI_EVAL_MAX_CHECKS = 10
/** Judge score (0..1) from which a case passes the judge. */
export const AI_EVAL_JUDGE_PASS_SCORE = 0.7
