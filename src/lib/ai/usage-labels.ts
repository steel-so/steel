import { findAiModel } from './models'

/**
 * pt-BR labels for the AI usage ledger (`AiUsage.feature` / `module`).
 * Isomorphic: used by the analytics mapper, the CSV export and the UI.
 */

export const AI_USAGE_FEATURE_KEYS = [
  'STEEL_ASSISTANT',
  'STEEL_AGENT',
  'CRM_ASSISTANT',
  'WHATSAPP_REPLY',
  'WHATSAPP_SENTIMENT',
  'SERVICEDESK_COPILOT',
  'SERVICEDESK_PRE_SERVICE',
  'SERVICEDESK_TRIAGE',
  'WIKI_ASSISTANT',
  'KNOWLEDGE_SEARCH',
  'AI_EVAL',
  'AI_GUARDRAIL',
  'PHONE_CALL_AI',
] as const
export type AiUsageFeatureKey = (typeof AI_USAGE_FEATURE_KEYS)[number]

export const AI_USAGE_FEATURE_LABELS: Record<AiUsageFeatureKey, string> = {
  STEEL_ASSISTANT: 'Steel AI (assistente)',
  STEEL_AGENT: 'Steel Agents',
  CRM_ASSISTANT: 'Assistente do CRM (antigo)',
  WHATSAPP_REPLY: 'Resposta automática do WhatsApp',
  WHATSAPP_SENTIMENT: 'Análise de sentimento do WhatsApp',
  SERVICEDESK_COPILOT: 'Copiloto do ServiceDesk',
  SERVICEDESK_PRE_SERVICE: 'Pré-atendimento do ServiceDesk',
  SERVICEDESK_TRIAGE: 'Triagem do ServiceDesk',
  WIKI_ASSISTANT: 'IA da Wiki',
  KNOWLEDGE_SEARCH: 'Busca de conhecimento',
  AI_EVAL: 'Avaliações do Steel AI',
  AI_GUARDRAIL: 'Proteções da IA (classificador)',
  PHONE_CALL_AI: 'Ligações (transcrição e resumo)',
}

/** `PLATFORM` = no module (platform tools, or a call that used no tool). */
export const AI_USAGE_MODULE_KEYS = [
  'SERVICE_DESK',
  'CRM',
  'COMMUNICATION',
  'PLATFORM',
] as const
export type AiUsageModuleKey = (typeof AI_USAGE_MODULE_KEYS)[number]

export const AI_USAGE_MODULE_LABELS: Record<AiUsageModuleKey, string> = {
  SERVICE_DESK: 'ServiceDesk',
  CRM: 'CRM',
  COMMUNICATION: 'Comunicação',
  PLATFORM: 'Plataforma',
}

/**
 * Module of the features that belong to a single module. Their rows were
 * recorded before `AiUsage.module` existed (or by callers that do not set
 * it), so the scope falls back to the feature's own module.
 */
const FEATURE_MODULE: Record<
  AiUsageFeatureKey,
  Exclude<AiUsageModuleKey, 'PLATFORM'> | null
> = {
  STEEL_ASSISTANT: null,
  STEEL_AGENT: null,
  CRM_ASSISTANT: 'CRM',
  WHATSAPP_REPLY: 'COMMUNICATION',
  WHATSAPP_SENTIMENT: 'COMMUNICATION',
  SERVICEDESK_COPILOT: 'SERVICE_DESK',
  SERVICEDESK_PRE_SERVICE: 'SERVICE_DESK',
  SERVICEDESK_TRIAGE: 'SERVICE_DESK',
  WIKI_ASSISTANT: null,
  KNOWLEDGE_SEARCH: null,
  AI_EVAL: null,
  AI_GUARDRAIL: null,
  PHONE_CALL_AI: 'COMMUNICATION',
}

/** Scope of a ledger row: its module, else the feature's, else platform. */
export function aiUsageModuleKey(
  feature: AiUsageFeatureKey,
  module: Exclude<AiUsageModuleKey, 'PLATFORM'> | null,
): AiUsageModuleKey {
  return module ?? FEATURE_MODULE[feature] ?? 'PLATFORM'
}

/** Catalog label of a ledger model (`provider` + `model` columns). */
export function aiUsageModelLabel(provider: string, model: string): string {
  return findAiModel(`${provider}:${model}`)?.label ?? model
}

/** Label of the ledger rows with no user (background jobs). */
export const AI_USAGE_NO_USER_LABEL = 'Automações (sem usuário)'
