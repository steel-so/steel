import type { WorkspaceAiSettings } from '@prisma/client'
import {
  AI_MODEL_CATALOG,
  AI_PROVIDER_LABELS,
  AI_PROVIDERS,
  type AiModelKey,
  type AiProviderId,
  DEFAULT_AI_MODEL_KEY,
  DEFAULT_MONTHLY_QUOTA_USD,
  isAiModelKey,
} from '@/src/lib/ai/models'
import { isQuotaExceeded, remainingUsd } from '@/src/lib/ai/quota'
import type { AiRoutingDefaults } from '@/src/mappers/platform-ai-settings.mapper'
import type { AiUsageTotals } from '@/src/repositories/ai-settings.repository'
import type { WorkspaceAiSettingsDTO } from '@/types/ai-settings'
import { toAiModelPriceDTOs } from './platform-ai-settings.mapper'

/** Ajustes efetivos: a linha salva ou, sem linha, os padrões da plataforma. */
export interface EffectiveAiSettings {
  enabledModels: AiModelKey[]
  crmAssistantModel: AiModelKey
  whatsappReplyModel: AiModelKey
  whatsappSentimentModel: AiModelKey
  monthlyQuotaUsd: number
  /** Steel AI agent mode (write tools); on by default. */
  agentModeEnabled: boolean
  /** Master switch of Steel AI; on by default. */
  aiEnabled: boolean
  /** Steel Agents may run; on by default. */
  agentsEnabled: boolean
  /** Steel AI memory; on by default. */
  memoryEnabled: boolean
  /** Autopilot (writes without confirmation); off by default. */
  autopilotEnabled: boolean
  /** Weekly usage summary e-mailed to the owners; on by default. */
  usageWeeklyEmailEnabled: boolean
  /** MCP clients with `mcp:write` may write; off by default. */
  mcpWriteEnabled: boolean
  /** Model of the AGENT task class; null = platform default / assistant's. */
  agentModel: AiModelKey | null
  /** Provider failover (ADR 0042); on by default. */
  failoverEnabled: boolean
  /** Proactive AI (insights + daily digest, ADR 0040); on by default. */
  proactiveEnabled: boolean
}

function modelOrDefault(key: string): AiModelKey {
  return isAiModelKey(key) ? key : DEFAULT_AI_MODEL_KEY
}

/**
 * `defaults` = the platform routing defaults (ADR 0042): a workspace
 * without a saved row starts from the model the global admin picked for
 * each task class.
 */
export function toEffectiveAiSettings(
  row: WorkspaceAiSettings | null,
  defaults?: AiRoutingDefaults,
): EffectiveAiSettings {
  if (!row) {
    const task = defaults?.taskModels
    return {
      enabledModels: AI_MODEL_CATALOG.map((m) => m.key),
      crmAssistantModel: task?.ASSISTANT ?? DEFAULT_AI_MODEL_KEY,
      whatsappReplyModel: task?.CONVERSATION ?? DEFAULT_AI_MODEL_KEY,
      whatsappSentimentModel: task?.CLASSIFICATION ?? DEFAULT_AI_MODEL_KEY,
      monthlyQuotaUsd: DEFAULT_MONTHLY_QUOTA_USD,
      agentModeEnabled: true,
      aiEnabled: true,
      agentsEnabled: true,
      memoryEnabled: true,
      autopilotEnabled: false,
      usageWeeklyEmailEnabled: true,
      mcpWriteEnabled: false,
      agentModel: null,
      failoverEnabled: true,
      proactiveEnabled: true,
    }
  }
  return {
    // Descarta chaves que saíram do catálogo (modelo descontinuado).
    enabledModels: row.enabledModels.filter(isAiModelKey),
    crmAssistantModel: modelOrDefault(row.crmAssistantModel),
    whatsappReplyModel: modelOrDefault(row.whatsappReplyModel),
    whatsappSentimentModel: modelOrDefault(row.whatsappSentimentModel),
    monthlyQuotaUsd: row.monthlyQuotaUsd.toNumber(),
    agentModeEnabled: row.agentModeEnabled,
    aiEnabled: row.aiEnabled,
    agentsEnabled: row.agentsEnabled,
    memoryEnabled: row.memoryEnabled,
    autopilotEnabled: row.autopilotEnabled,
    usageWeeklyEmailEnabled: row.usageWeeklyEmailEnabled,
    mcpWriteEnabled: row.mcpWriteEnabled,
    agentModel:
      row.agentModel && isAiModelKey(row.agentModel) ? row.agentModel : null,
    failoverEnabled: row.failoverEnabled,
    proactiveEnabled: row.proactiveEnabled,
  }
}

export function toWorkspaceAiSettingsDTO(input: {
  workspaceId: string
  settings: EffectiveAiSettings
  usage: AiUsageTotals
  periodStart: Date
  userPreference: string | null
  canManage: boolean
  isProviderAvailable: (provider: AiProviderId) => boolean
  /** Platform margin over the provider price (default 1 = at cost). */
  costMargin?: number
}): WorkspaceAiSettingsDTO {
  const { settings, usage } = input
  const enabled = new Set<string>(settings.enabledModels)
  // Same order as the catalog.
  const prices = toAiModelPriceDTOs(input.costMargin ?? 1)
  const usedUsd = Math.round(usage.costUsd * 100) / 100

  return {
    workspaceId: input.workspaceId,
    providers: AI_PROVIDERS.map((id) => ({
      id,
      label: AI_PROVIDER_LABELS[id],
      available: input.isProviderAvailable(id),
    })),
    models: AI_MODEL_CATALOG.map((m, index) => ({
      key: m.key,
      provider: m.provider,
      model: m.model,
      label: m.label,
      available: input.isProviderAvailable(m.provider),
      enabled: enabled.has(m.key),
      inputUsdPer1M: prices[index].chargedInputUsdPer1M,
      outputUsdPer1M: prices[index].chargedOutputUsdPer1M,
    })),
    enabledModels: settings.enabledModels,
    crmAssistantModel: settings.crmAssistantModel,
    whatsappReplyModel: settings.whatsappReplyModel,
    whatsappSentimentModel: settings.whatsappSentimentModel,
    monthlyQuotaUsd: settings.monthlyQuotaUsd,
    agentModeEnabled: settings.agentModeEnabled,
    aiEnabled: settings.aiEnabled,
    agentsEnabled: settings.agentsEnabled,
    memoryEnabled: settings.memoryEnabled,
    autopilotEnabled: settings.autopilotEnabled,
    usageWeeklyEmailEnabled: settings.usageWeeklyEmailEnabled,
    mcpWriteEnabled: settings.mcpWriteEnabled,
    agentModel: settings.agentModel,
    failoverEnabled: settings.failoverEnabled,
    proactiveEnabled: settings.proactiveEnabled,
    usage: {
      periodStart: input.periodStart.toISOString(),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      usedUsd,
      remainingUsd: remainingUsd(usage.costUsd, settings.monthlyQuotaUsd),
      exceeded: isQuotaExceeded(usage.costUsd, settings.monthlyQuotaUsd),
    },
    userPreference: input.userPreference,
    canManage: input.canManage,
  }
}
