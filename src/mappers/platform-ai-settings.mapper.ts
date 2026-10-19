import type { PlatformAiSettings } from '@prisma/client'
import {
  AI_MODEL_CATALOG,
  type AiModelKey,
  type AiTaskClass,
  DEFAULT_AI_COST_MARGIN,
  isAiModelKey,
} from '@/src/lib/ai/models'
import type {
  PlatformAiModelPriceDTO,
  PlatformAiSettingsDTO,
  PlatformKnowledgeSearchStatusDTO,
} from '@/types/platform-ai-settings'

/** Margin of the saved row, or the default when there is none. */
export function toCostMargin(row: PlatformAiSettings | null): number {
  return row ? row.costMargin.toNumber() : DEFAULT_AI_COST_MARGIN
}

function charged(price: number, margin: number): number {
  return Math.round(price * margin * 10_000) / 10_000
}

/** Catalog prices with the margin applied (US$ per 1M tokens). */
export function toAiModelPriceDTOs(margin: number): PlatformAiModelPriceDTO[] {
  return AI_MODEL_CATALOG.map((m) => ({
    key: m.key,
    provider: m.provider,
    label: m.label,
    inputUsdPer1M: m.pricing.inputUsdPer1M,
    outputUsdPer1M: m.pricing.outputUsdPer1M,
    cachedInputUsdPer1M: m.pricing.cachedInputUsdPer1M,
    chargedInputUsdPer1M: charged(m.pricing.inputUsdPer1M, margin),
    chargedOutputUsdPer1M: charged(m.pricing.outputUsdPer1M, margin),
  }))
}

/** Embeddings switch of the saved row (default on). */
export function toEmbeddingsEnabled(row: PlatformAiSettings | null): boolean {
  return row ? row.embeddingsEnabled : true
}

/** Platform routing defaults (ADR 0042): model per task class + failover. */
export interface AiRoutingDefaults {
  /** Null = the platform default model (agents: the assistant's). */
  taskModels: Record<AiTaskClass, AiModelKey | null>
  failoverEnabled: boolean
}

function modelKeyOrNull(key: string | null | undefined): AiModelKey | null {
  return key && isAiModelKey(key) ? key : null
}

export function toAiRoutingDefaults(
  row: PlatformAiSettings | null,
): AiRoutingDefaults {
  return {
    taskModels: {
      CLASSIFICATION: modelKeyOrNull(row?.classificationModel),
      CONVERSATION: modelKeyOrNull(row?.conversationModel),
      ASSISTANT: modelKeyOrNull(row?.assistantModel),
      AGENT: modelKeyOrNull(row?.agentModel),
    },
    failoverEnabled: row ? row.failoverEnabled : true,
  }
}

const TEXT_ONLY: PlatformKnowledgeSearchStatusDTO = {
  providerConfigured: false,
  vectorIndexReady: false,
  mode: 'text',
}

export function toPlatformAiSettingsDTO(
  row: PlatformAiSettings | null,
  knowledgeSearch: PlatformKnowledgeSearchStatusDTO = TEXT_ONLY,
): PlatformAiSettingsDTO {
  const margin = toCostMargin(row)
  const routing = toAiRoutingDefaults(row)
  return {
    costMargin: margin,
    updatedAt: row ? row.updatedAt.toISOString() : null,
    models: toAiModelPriceDTOs(margin),
    embeddingsEnabled: toEmbeddingsEnabled(row),
    knowledgeSearch,
    taskModels: routing.taskModels,
    failoverEnabled: routing.failoverEnabled,
  }
}
