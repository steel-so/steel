import type {
  AiInsightKindDTO,
  AiInsightModuleDTO,
  AiInsightSeverityDTO,
} from '@/types/ai-insight'

/**
 * pt-BR labels of the proactive AI (ADR 0040). Isomorphic: the cards, the
 * e-mail, the digest and the `ws_insights` tool read the same table.
 */

export const AI_INSIGHT_KINDS = [
  'SD_SLA_BREACH_FORECAST',
  'CRM_STALE_OPPORTUNITIES',
  'CRM_STALLED_STAGE',
  'CRM_FORECAST_GAP',
  'ZAP_WAITING_TOO_LONG',
  'ZAP_NEGATIVE_SENTIMENT',
] as const satisfies readonly AiInsightKindDTO[]

export const AI_INSIGHT_MODULES = [
  'SERVICE_DESK',
  'CRM',
  'COMMUNICATION',
] as const satisfies readonly AiInsightModuleDTO[]

export const AI_INSIGHT_KIND_LABELS: Record<AiInsightKindDTO, string> = {
  SD_SLA_BREACH_FORECAST: 'Previsão de estouro de SLA',
  CRM_STALE_OPPORTUNITIES: 'Oportunidades sem contato',
  CRM_STALLED_STAGE: 'Etapa travada',
  CRM_FORECAST_GAP: 'Previsão abaixo da meta',
  ZAP_WAITING_TOO_LONG: 'Conversas aguardando',
  ZAP_NEGATIVE_SENTIMENT: 'Sentimento em queda',
}

export const AI_INSIGHT_MODULE_LABELS: Record<AiInsightModuleDTO, string> = {
  SERVICE_DESK: 'ServiceDesk',
  CRM: 'CRM',
  COMMUNICATION: 'Comunicação',
}

/** "no ServiceDesk" / "no CRM" / "na Comunicação". */
export const AI_INSIGHT_MODULE_IN: Record<AiInsightModuleDTO, string> = {
  SERVICE_DESK: 'no ServiceDesk',
  CRM: 'no CRM',
  COMMUNICATION: 'na Comunicação',
}

export const AI_INSIGHT_SEVERITY_LABELS: Record<AiInsightSeverityDTO, string> =
  {
    CRITICAL: 'Urgente',
    WARNING: 'Atenção',
    INFO: 'Informativo',
  }
