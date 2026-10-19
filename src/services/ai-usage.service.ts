import type { AiUsageFeature, ModuleKind } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
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
import { getAiCircuitBreaker } from '@/src/lib/ai/guardrails/circuit-breaker'
import { selectFallbackModels } from '@/src/lib/ai/guardrails/failover'
import {
  type AiCallGuard,
  type AiCallTarget,
  createGuardedProvider,
} from '@/src/lib/ai/guardrails/guarded-provider'
import {
  INJECTION_CLASSIFIER_PROMPT,
  INJECTION_CLASSIFIER_SCHEMA,
  parseClassifierVerdict,
  wrapUntrusted,
} from '@/src/lib/ai/guardrails/injection'
import { PII_KINDS } from '@/src/lib/ai/guardrails/pii'
import {
  AI_TASK_TIMEOUT_MS,
  type AiModelKey,
  type AiTaskClass,
  aiModelPricing,
} from '@/src/lib/ai/models'
import {
  currentPeriodStart,
  isQuotaExceeded,
  priceAiUsage,
} from '@/src/lib/ai/quota'
import { err, ok, type Result } from '@/src/lib/result'
import type { EffectiveAiGuardrails } from '@/src/mappers/ai-guardrails.mapper'
import {
  type EffectiveAiSettings,
  toEffectiveAiSettings,
} from '@/src/mappers/ai-settings.mapper'
import type { AiRoutingDefaults } from '@/src/mappers/platform-ai-settings.mapper'
import {
  AiUsageRepository,
  UserAiPreferenceRepository,
  WorkspaceAiSettingsRepository,
} from '@/src/repositories/ai-settings.repository'
import { AiGuardrailsService, shouldMaskPii } from './ai-guardrails.service'
import { isModelUsable } from './ai-settings.service'
import { PlatformAiSettingsService } from './platform-ai-settings.service'
import { notifyAiQuota } from './platform-notifications'

/**
 * Task class of each feature (ADR 0042). The class decides the model
 * (cheap for classification, strong for the assistant and the agents), the
 * failover tier and the per-call timeout. Classes are stored in the
 * workspace settings as: CLASSIFICATION = `whatsappSentimentModel`,
 * CONVERSATION = `whatsappReplyModel`, ASSISTANT = `crmAssistantModel`,
 * AGENT = `agentModel` (null = platform default for agents, else the
 * assistant's).
 */
export const AI_TASK_CLASS_BY_FEATURE: Record<AiUsageFeature, AiTaskClass> = {
  CRM_ASSISTANT: 'ASSISTANT',
  WHATSAPP_REPLY: 'CONVERSATION',
  WHATSAPP_SENTIMENT: 'CLASSIFICATION',
  SERVICEDESK_COPILOT: 'ASSISTANT',
  SERVICEDESK_PRE_SERVICE: 'CONVERSATION',
  SERVICEDESK_TRIAGE: 'CLASSIFICATION',
  STEEL_ASSISTANT: 'ASSISTANT',
  STEEL_AGENT: 'AGENT',
  WIKI_ASSISTANT: 'ASSISTANT',
  // Never resolved here: the knowledge search embeddings use their own
  // platform model (ADR 0037) and are recorded by AiKnowledgeEmbeddingService.
  KNOWLEDGE_SEARCH: 'CLASSIFICATION',
  // Eval runs (ADR 0039) run as the assistant; a run may pin a model.
  AI_EVAL: 'ASSISTANT',
  AI_GUARDRAIL: 'CLASSIFICATION',
}

/** Workspace model of a task class, most specific first. */
export function taskClassModels(
  settings: EffectiveAiSettings,
  taskClass: AiTaskClass,
  defaults: AiRoutingDefaults,
): (AiModelKey | null)[] {
  switch (taskClass) {
    case 'CLASSIFICATION':
      return [settings.whatsappSentimentModel]
    case 'CONVERSATION':
      return [settings.whatsappReplyModel]
    case 'ASSISTANT':
      return [settings.crmAssistantModel]
    case 'AGENT':
      return [
        settings.agentModel,
        defaults.taskModels.AGENT,
        settings.crmAssistantModel,
      ]
  }
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
  /** Task class of the feature (ADR 0042). */
  taskClass?: AiTaskClass
  /**
   * What the guardrails did on this call (ADR 0041): masked counts,
   * prompt-injection detection (`tainted()`), failovers. Absent on calls
   * built by hand (tests).
   */
  guard?: AiCallGuard
  /** Guardrails in force when the call was prepared (auto-reply limits). */
  guardrails?: EffectiveAiGuardrails
}

/** Masked values already audited per call (record may run several times). */
const auditedPii = new WeakMap<PreparedAiCall, number>()

function auditPiiMasking(
  call: PreparedAiCall,
  userId: string | null,
  workspaceId: string,
) {
  if (!call.guard) return
  const counts = call.guard.report.piiCounts
  const total = PII_KINDS.reduce((sum, kind) => sum + counts[kind], 0)
  if (total <= (auditedPii.get(call) ?? 0)) return
  auditedPii.set(call, total)
  // Counts only — the masked values never leave the call's vault.
  auditMutation({
    entity: 'ai_guardrail',
    action: 'mask',
    actorId: userId,
    targetId: workspaceId,
    meta: { workspaceId, feature: call.feature, total, counts },
  })
}

/**
 * Optional prompt-injection classifier (ADR 0041): asks the cheap
 * classification model whether a suspicious third-party text is an
 * instruction to the AI. Its cost is recorded as AI_GUARDRAIL. Any failure
 * answers "no": the heuristics already ran and the policy stays in force.
 */
async function classifyInjection(
  workspaceId: string,
  text: string,
): Promise<boolean> {
  const prepared = await AiUsageService.prepare(workspaceId, 'AI_GUARDRAIL')
  if (!prepared.ok) return false
  const call = prepared.value
  const usage: AiUsageTokens = { inputTokens: 0, outputTokens: 0 }
  try {
    const response = await call.provider.chat({
      model: call.model.model,
      system: INJECTION_CLASSIFIER_PROMPT,
      messages: [
        {
          role: 'user',
          content: wrapUntrusted(text.slice(0, 4_000), 'tool_result'),
        },
      ],
      jsonSchema: INJECTION_CLASSIFIER_SCHEMA,
      maxTokens: 60,
    })
    usage.inputTokens = response.usage.inputTokens
    usage.outputTokens = response.usage.outputTokens
    return parseClassifierVerdict(response.text)
  } catch (error) {
    logger.warn(
      'ai.injection_classifier_failed',
      logFields(
        {
          component: 'AiUsageService',
          workspaceId,
          message: error instanceof Error ? error.message : String(error),
        },
        { model: call.model.key },
      ),
    )
    return false
  } finally {
    await AiUsageService.record(call, { workspaceId, userId: null, usage })
  }
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
    const defaults = await PlatformAiSettingsService.getRoutingDefaults()
    const settings = toEffectiveAiSettings(row.value, defaults)

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
      ...taskClassModels(
        settings,
        AI_TASK_CLASS_BY_FEATURE[feature],
        defaults,
      ).filter((key): key is AiModelKey => Boolean(key)),
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

    const guardrails = await AiGuardrailsService.loadEffective(workspaceId)
    if (!guardrails.ok) return guardrails

    const [costMargin, routing] = await Promise.all([
      PlatformAiSettingsService.getCostMargin(),
      PlatformAiSettingsService.getRoutingDefaults(),
    ])
    const taskClass = AI_TASK_CLASS_BY_FEATURE[feature]
    const fallbacks: AiCallTarget[] =
      settings.failoverEnabled && routing.failoverEnabled
        ? selectFallbackModels(
            model,
            settings.enabledModels
              .filter((key) => isModelUsable(settings, key))
              .map((key) => findAiModel(key) as AiModelDefinition),
            taskClass,
          ).flatMap((fallback) => {
            const fallbackProvider = getAiProvider(fallback.provider)
            return fallbackProvider
              ? [{ model: fallback, provider: fallbackProvider }]
              : []
          })
        : []

    const call: PreparedAiCall = {
      feature,
      provider,
      model,
      costMargin,
      monthlyQuotaUsd: settings.monthlyQuotaUsd,
      taskClass,
      guardrails: guardrails.value,
    }
    const guarded = createGuardedProvider({
      primary: { model, provider },
      fallbacks,
      maskPii: shouldMaskPii(guardrails.value.piiMaskingPolicy, feature),
      // The classifier call itself is never classified (no recursion).
      ...(guardrails.value.injectionClassifierEnabled &&
        feature !== 'AI_GUARDRAIL' && {
          classify: (text: string) => classifyInjection(workspaceId, text),
        }),
      ...(fallbacks.length > 0 && { breaker: getAiCircuitBreaker() }),
      timeoutMs: AI_TASK_TIMEOUT_MS[taskClass],
      onModelChange: (next) => {
        call.model = next
      },
      onInjection: ({ signals, source }) =>
        auditMutation({
          entity: 'ai_guardrail',
          action: 'alert',
          actorId: userId ?? null,
          targetId: workspaceId,
          meta: {
            workspaceId,
            feature,
            kind: 'prompt_injection',
            source,
            signals,
          },
        }),
      log: { workspaceId, feature },
    })
    call.provider = guarded.provider
    call.guard = guarded.guard
    return ok(call)
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
    auditPiiMasking(call, input.userId, input.workspaceId)
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
          ...(call.guard &&
            call.guard.report.failovers.length > 0 && {
              failovers: call.guard.report.failovers,
            }),
        },
      ),
    )

    await warnQuotaThreshold(input.workspaceId, call.monthlyQuotaUsd)
  },
}
