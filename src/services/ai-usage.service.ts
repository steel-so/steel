import type { AiUsageFeature, ModuleKind } from '@prisma/client'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import { aiProviderUnavailable, aiQuotaExceeded } from '@/src/errors'
import {
  type AiModelDefinition,
  type AiProvider,
  type AiUsageTokens,
  findAiModel,
  getAiProvider,
} from '@/src/lib/ai'
import { aiModelPricing } from '@/src/lib/ai/models'
import {
  currentPeriodStart,
  isQuotaExceeded,
  priceAiUsage,
} from '@/src/lib/ai/quota'
import { err, ok, type Result } from '@/src/lib/result'
import {
  type EffectiveAiSettings,
  toEffectiveAiSettings,
} from '@/src/mappers/ai-settings.mapper'
import {
  AiUsageRepository,
  UserAiPreferenceRepository,
  WorkspaceAiSettingsRepository,
} from '@/src/repositories/ai-settings.repository'
import { AI_FEATURE_SETTING_FIELDS, isModelUsable } from './ai-settings.service'
import { PlatformAiSettingsService } from './platform-ai-settings.service'
import { notifyAiQuota } from './platform-notifications'

/**
 * Modelo padrão de cada funcionalidade. As do ServiceDesk ainda não têm
 * seletor próprio em Ajustes > Steel IA e herdam o de uma equivalente:
 * copiloto (conversa com o agente) = assistente do CRM; pré-atendimento
 * (conversa com o solicitante) = resposta automática do WhatsApp; triagem
 * (classificação) = análise de sentimento.
 */
const MODEL_FIELD_BY_FEATURE: Record<
  AiUsageFeature,
  keyof Pick<
    EffectiveAiSettings,
    'crmAssistantModel' | 'whatsappReplyModel' | 'whatsappSentimentModel'
  >
> = {
  ...AI_FEATURE_SETTING_FIELDS,
  SERVICEDESK_COPILOT: 'crmAssistantModel',
  SERVICEDESK_PRE_SERVICE: 'whatsappReplyModel',
  SERVICEDESK_TRIAGE: 'whatsappSentimentModel',
  // Steel AI reuses the assistant model setting (the CRM widget is gone).
  STEEL_ASSISTANT: 'crmAssistantModel',
  STEEL_AGENT: 'crmAssistantModel',
  // Wiki inline rewrite (paraphrase, summarize...) uses the assistant model.
  WIKI_ASSISTANT: 'crmAssistantModel',
  // Never resolved here: the knowledge search embeddings use their own
  // platform model (ADR 0037) and are recorded by AiKnowledgeEmbeddingService.
  KNOWLEDGE_SEARCH: 'whatsappSentimentModel',
  // Eval runs (ADR 0039) default to the assistant model; a run may pin one.
  AI_EVAL: 'crmAssistantModel',
}

/** Features where the user's own model preference applies. */
const USER_PREFERENCE_FEATURES = new Set<AiUsageFeature>([
  'CRM_ASSISTANT',
  'STEEL_ASSISTANT',
])

/** Share of the monthly quota that triggers the early warning. */
export const AI_QUOTA_WARNING_RATIO = 0.8

/**
 * After a usage write: notifies the admins when the month crosses 80% or
 * 100% of the quota. Idempotent per month and threshold (dedupe key), so
 * calling it after every AI call is safe. Never fails the caller.
 */
async function warnQuotaThreshold(
  workspaceId: string,
  quotaUsd: number | undefined,
): Promise<void> {
  if (!quotaUsd || quotaUsd <= 0) return
  const periodStart = currentPeriodStart()
  const usage = await AiUsageRepository.sumSince(workspaceId, periodStart)
  if (!usage.ok) return
  const used = usage.value.costUsd
  const threshold = isQuotaExceeded(used, quotaUsd)
    ? 'exceeded'
    : used >= quotaUsd * AI_QUOTA_WARNING_RATIO
      ? 'warning'
      : null
  if (!threshold) return
  await notifyAiQuota({
    workspaceId,
    threshold,
    period: periodStart.toISOString().slice(0, 7),
  })
}

export interface PreparedAiCall {
  feature: AiUsageFeature
  provider: AiProvider
  model: AiModelDefinition
  /**
   * Platform margin over the provider price, read when the call was
   * prepared (absent = 1.0, at cost). See ADR 0019.
   */
  costMargin?: number
  /**
   * @deprecated The fixed US$ 4 / 1k tokens rule is gone (ADR 0019); cost
   * comes from the model price × `costMargin`. Ignored if set.
   */
  usdPer1kTokens?: number
  /**
   * Monthly quota of the workspace when the call was prepared — `record`
   * uses it to warn the admins at 80% and at 100% (absent = no warning).
   */
  monthlyQuotaUsd?: number
}

/**
 * Porta de entrada de toda chamada de IA do produto: resolve o provedor/
 * modelo e aplica a cota mensal *antes* da chamada; depois dela, `record`
 * lança o consumo no livro-razão (base da cota). Sem autorização aqui — o
 * chamador (service com usuário, ou job em background) já validou o escopo.
 */
export const AiUsageService = {
  /**
   * Ordem de resolução do modelo:
   *  1. preferência do usuário (só nos assistentes conversacionais — Steel AI
   *     e o antigo assistente do CRM; jobs em background não têm usuário e
   *     usam o padrão do workspace);
   *  2. padrão do workspace para a funcionalidade;
   *  3. primeiro modelo habilitado cujo provedor está disponível.
   * Candidatos desabilitados ou de provedor sem chave são pulados. Não
   * confere a cota — `prepare` faz isso.
   */
  async resolveModel(
    workspaceId: string,
    feature: AiUsageFeature,
    userId?: string | null,
    /**
     * Tried before everything else, in order — e.g. the model picked for a
     * Steel AI conversation. Unusable ones are skipped like any candidate.
     */
    preferredModelKeys: (string | null | undefined)[] = [],
  ): Promise<
    Result<{
      settings: EffectiveAiSettings
      model: AiModelDefinition | null
    }>
  > {
    const row = await WorkspaceAiSettingsRepository.findByWorkspace(workspaceId)
    if (!row.ok) return row
    const settings = toEffectiveAiSettings(row.value)

    const candidates: string[] = preferredModelKeys.filter(
      (key): key is string => Boolean(key),
    )
    if (USER_PREFERENCE_FEATURES.has(feature) && userId) {
      const preference = await UserAiPreferenceRepository.find(
        workspaceId,
        userId,
      )
      if (!preference.ok) return preference
      if (preference.value) candidates.push(preference.value.modelKey)
    }
    candidates.push(
      settings[MODEL_FIELD_BY_FEATURE[feature]],
      ...settings.enabledModels,
    )

    const key = candidates.find((candidate) =>
      isModelUsable(settings, candidate),
    )
    // isModelUsable() already guarantees the key is in the catalog.
    const model = key ? (findAiModel(key) as AiModelDefinition) : null
    return ok({ settings, model })
  },

  async prepare(
    workspaceId: string,
    feature: AiUsageFeature,
    userId?: string | null,
    preferredModelKeys: (string | null | undefined)[] = [],
  ): Promise<Result<PreparedAiCall>> {
    const resolved = await AiUsageService.resolveModel(
      workspaceId,
      feature,
      userId,
      preferredModelKeys,
    )
    if (!resolved.ok) return resolved
    const { settings, model } = resolved.value
    const provider = model ? getAiProvider(model.provider) : null
    if (!model || !provider) return err(aiProviderUnavailable())

    const usage = await AiUsageRepository.sumSince(
      workspaceId,
      currentPeriodStart(),
    )
    if (!usage.ok) return usage
    if (isQuotaExceeded(usage.value.costUsd, settings.monthlyQuotaUsd)) {
      logger.warn(
        'ai.quota_exceeded',
        logFields(
          { component: 'AiUsageService', workspaceId },
          {
            feature,
            usedUsd: usage.value.costUsd,
            quotaUsd: settings.monthlyQuotaUsd,
          },
        ),
      )
      return err(
        aiQuotaExceeded(
          Math.round(usage.value.costUsd * 100) / 100,
          settings.monthlyQuotaUsd,
        ),
      )
    }

    const costMargin = await PlatformAiSettingsService.getCostMargin()

    return ok({
      feature,
      provider,
      model,
      costMargin,
      monthlyQuotaUsd: settings.monthlyQuotaUsd,
    })
  },

  /**
   * Cost (US$) of `usage` under the prepared call's pricing — the same rule
   * `record` freezes in the ledger (model price × platform margin). For
   * callers that also keep the cost on their own record (Steel Agents runs).
   */
  price(call: PreparedAiCall, usage: AiUsageTokens): number {
    return priceAiUsage(aiModelPricing(call.model), usage, call.costMargin ?? 1)
  },

  /**
   * Lança o consumo de uma interação (pode somar várias chamadas, ex.: o
   * loop de tools). Falha de escrita só é logada — a resposta já foi gerada.
   */
  async record(
    call: PreparedAiCall,
    input: {
      workspaceId: string
      userId: string | null
      usage: AiUsageTokens
      /**
       * Analytics scope: module whose tools the interaction used (null =
       * none/platform), and the conversation or agent run it belongs to.
       */
      scope?: {
        module?: ModuleKind | null
        conversationId?: string | null
        agentRunId?: string | null
      }
    },
  ): Promise<void> {
    // Chamada que falhou antes de consumir qualquer token: nada a lançar.
    if (input.usage.inputTokens === 0 && input.usage.outputTokens === 0) {
      return
    }
    // Real cost frozen at call time: provider price of the model × margin.
    const costUsd = priceAiUsage(
      aiModelPricing(call.model),
      input.usage,
      call.costMargin ?? 1,
    )
    const result = await AiUsageRepository.record({
      workspaceId: input.workspaceId,
      userId: input.userId,
      feature: call.feature,
      provider: call.model.provider,
      model: call.model.model,
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens,
      costUsd,
      ...(input.scope && {
        module: input.scope.module ?? null,
        conversationId: input.scope.conversationId ?? null,
        agentRunId: input.scope.agentRunId ?? null,
      }),
    })

    if (!result.ok) {
      logger.error(
        'ai.usage_record_failed',
        logFields(
          {
            component: 'AiUsageService',
            workspaceId: input.workspaceId,
            message: result.error.message,
          },
          { feature: call.feature },
        ),
      )
      return
    }

    logger.info(
      'ai.usage_recorded',
      logFields(
        { component: 'AiUsageService', workspaceId: input.workspaceId },
        {
          feature: call.feature,
          model: call.model.key,
          inputTokens: input.usage.inputTokens,
          cachedInputTokens: input.usage.cachedInputTokens ?? 0,
          outputTokens: input.usage.outputTokens,
          costMargin: call.costMargin ?? 1,
          costUsd,
        },
      ),
    )

    await warnQuotaThreshold(input.workspaceId, call.monthlyQuotaUsd)
  },
}
