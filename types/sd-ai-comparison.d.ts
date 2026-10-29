/**
 * Painel "IA vs. técnico" do ServiceDesk
 * (`GET /api/workspaces/[id]/servicedesk/ai/comparison`): o que a IA sugeriu
 * (triagem automática e copiloto) comparado com o que o técnico fez.
 */

/** Campos de classificação que a IA sugere e o técnico pode corrigir. */
export type SdAiComparedField =
  | 'category'
  | 'subcategory'
  | 'service'
  | 'impact'
  | 'urgency'
  | 'priority'
  | 'department'
  | 'tags'

/**
 * O que aconteceu com uma sugestão de campo:
 * - `APPLIED_KEPT`: a IA preencheu e o técnico manteve;
 * - `APPLIED_CHANGED`: a IA preencheu e o técnico corrigiu;
 * - `AGREED`: o campo já vinha preenchido e coincide com a sugestão;
 * - `DISAGREED`: o campo já vinha preenchido e difere da sugestão.
 */
export type SdAiFieldOutcome =
  | 'APPLIED_KEPT'
  | 'APPLIED_CHANGED'
  | 'AGREED'
  | 'DISAGREED'

/** Desfecho de uma sugestão em texto (resposta ou solução). */
export type SdAiTextOutcome = 'ADOPTED' | 'EDITED' | 'NOT_USED' | 'PENDING'

export interface SdAiFieldStatDTO {
  field: SdAiComparedField
  label: string
  /** Sugestões comparadas neste campo. */
  compared: number
  /** Sugestões que coincidem com o valor final do chamado. */
  matched: number
  /** A IA preencheu e o técnico trocou depois. */
  corrected: number
  /** `matched / compared` em %, `null` sem amostra. */
  accuracy: number | null
}

export interface SdAiCalibrationBucketDTO {
  /** `LOW` (< 50%), `MEDIUM` (50–79%) ou `HIGH` (≥ 80%) de confiança. */
  band: 'LOW' | 'MEDIUM' | 'HIGH'
  label: string
  tickets: number
  /** Acerto médio dos campos comparados nesses chamados, em %. */
  accuracy: number | null
}

export interface SdAiTextStatDTO {
  kind: 'REPLY' | 'SOLUTION'
  label: string
  /** Sugestões entregues no período. */
  total: number
  adopted: number
  edited: number
  notUsed: number
  /** Ainda sem desfecho (recentes ou chamado em aberto). */
  pending: number
  /** `(adopted + edited) / (total - pending)` em %. */
  usageRate: number | null
}

export interface SdAiAgentStatDTO {
  userId: string
  name: string
  /** Sugestões do copiloto pedidas pelo agente (texto e classificação). */
  suggestions: number
  /** Sugestões aproveitadas (adotadas, editadas ou campos coincidentes). */
  used: number
  usageRate: number | null
}

export interface SdAiDivergenceDTO {
  ticketId: string
  code: string
  title: string
  field: SdAiComparedField
  fieldLabel: string
  /** Nome sugerido pela IA. */
  suggested: string
  /** Valor final do técnico. */
  final: string
  /** `true` quando a IA tinha preenchido o campo. */
  appliedByAi: boolean
  at: string
}

export interface SdAiUsageDTO {
  /** Chamadas à IA do ServiceDesk no período (todas as funções). */
  calls: number
  costUsd: number
  /** Custo por sugestão aproveitada, `null` sem aproveitamento. */
  costPerUsedUsd: number | null
  features: Array<{
    feature: string
    label: string
    calls: number
    costUsd: number
  }>
}

export interface SdAiPreServiceDTO {
  conversations: number
  /** Resolvidas pela base de conhecimento, sem chamado. */
  resolvedByKb: number
  ticketOpened: number
  abandoned: number
  /** Ainda sem desfecho. */
  open: number
  /** `resolvedByKb / (conversations - open)` em %. */
  deflectionRate: number | null
}

export interface SdAiComparisonDTO {
  periodDays: number
  from: string
  to: string
  summary: {
    /** Chamados triados pela IA no período. */
    triaged: number
    /** Desses, os já resolvidos/fechados (entram na precisão). */
    settled: number
    /** Triados ainda em andamento (aguardam o técnico). */
    awaitingReview: number
    /** Acerto geral dos campos comparados, em %. */
    accuracy: number | null
    /** Campos preenchidos pela IA que o técnico corrigiu. */
    corrections: number
    avgConfidence: number | null
  }
  fields: SdAiFieldStatDTO[]
  calibration: SdAiCalibrationBucketDTO[]
  texts: SdAiTextStatDTO[]
  agents: SdAiAgentStatDTO[]
  preService: SdAiPreServiceDTO
  usage: SdAiUsageDTO
  /** Últimas divergências (campos onde o técnico discordou da IA). */
  divergences: SdAiDivergenceDTO[]
}
