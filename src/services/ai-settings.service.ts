import { auditMutation } from '@/lib/axiom/audit'
import {
  aiModelNotEnabled,
  aiProviderUnavailable,
  validationError,
} from '@/src/errors'
import {
  AI_FEATURE_LABELS,
  AI_PROVIDER_LABELS,
  type AiFeature,
  type AiModelKey,
  findAiModel,
  isAiProviderConfigured,
} from '@/src/lib/ai'
import { onWorkspaceAiSwitch } from '@/src/lib/ai/knowledge/index-hooks'
import { currentPeriodStart } from '@/src/lib/ai/quota'
import { err, ok, type Result } from '@/src/lib/result'
import {
  type EffectiveAiSettings,
  toEffectiveAiSettings,
  toWorkspaceAiSettingsDTO,
} from '@/src/mappers/ai-settings.mapper'
import {
  AiUsageRepository,
  UserAiPreferenceRepository,
  WorkspaceAiSettingsRepository,
} from '@/src/repositories/ai-settings.repository'
import type {
  SetUserAiPreferenceDTO,
  UpdateWorkspaceAiSettingsDTO,
} from '@/src/schemas/ai-settings.schema'
import type { WorkspaceAiSettingsDTO } from '@/types/ai-settings'
import { assertMember, assertPrivileged } from './authz'
import { PlatformAiSettingsService } from './platform-ai-settings.service'

export const AI_FEATURE_SETTING_FIELDS = {
  CRM_ASSISTANT: 'crmAssistantModel',
  WHATSAPP_REPLY: 'whatsappReplyModel',
  WHATSAPP_SENTIMENT: 'whatsappSentimentModel',
} as const satisfies Record<AiFeature, keyof EffectiveAiSettings>

export function isModelUsable(
  settings: EffectiveAiSettings,
  key: string,
): boolean {
  const model = findAiModel(key)
  return Boolean(
    model &&
      settings.enabledModels.includes(key as AiModelKey) &&
      isAiProviderConfigured(model.provider),
  )
}

async function loadEffective(
  workspaceId: string,
): Promise<Result<EffectiveAiSettings>> {
  const row = await WorkspaceAiSettingsRepository.findByWorkspace(workspaceId)
  if (!row.ok) return row
  const defaults = row.value
    ? undefined
    : await PlatformAiSettingsService.getRoutingDefaults()
  return ok(toEffectiveAiSettings(row.value, defaults))
}

async function buildDTO(
  actorId: string,
  workspaceId: string,
  settings: EffectiveAiSettings,
  canManage: boolean,
): Promise<Result<WorkspaceAiSettingsDTO>> {
  const periodStart = currentPeriodStart()
  const [usage, preference, costMargin] = await Promise.all([
    AiUsageRepository.sumSince(workspaceId, periodStart),
    UserAiPreferenceRepository.find(workspaceId, actorId),
    PlatformAiSettingsService.getCostMargin(),
  ])
  if (!usage.ok) return usage
  if (!preference.ok) return preference

  return ok(
    toWorkspaceAiSettingsDTO({
      workspaceId,
      settings,
      usage: usage.value,
      periodStart,
      userPreference: preference.value?.modelKey ?? null,
      canManage,
      isProviderAvailable: isAiProviderConfigured,
      costMargin,
    }),
  )
}

export const AiSettingsService = {
  /** Qualquer membro lê (precisa para escolher o próprio modelo). */
  async get(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WorkspaceAiSettingsDTO>> {
    const membership = await assertMember(actorId, workspaceId)
    if (!membership.ok) return membership

    const settings = await loadEffective(workspaceId)
    if (!settings.ok) return settings

    return buildDTO(
      actorId,
      workspaceId,
      settings.value,
      membership.value.isPrivileged,
    )
  },

  /** Só OWNER/ADMIN definem provedores/modelos habilitados e a cota. */
  async update(
    actorId: string,
    workspaceId: string,
    dto: UpdateWorkspaceAiSettingsDTO,
  ): Promise<Result<WorkspaceAiSettingsDTO>> {
    const privileged = await assertPrivileged(actorId, workspaceId)
    if (!privileged.ok) return privileged

    const current = await loadEffective(workspaceId)
    if (!current.ok) return current

    const next: EffectiveAiSettings = {
      ...current.value,
      ...(dto.enabledModels && { enabledModels: dto.enabledModels }),
      ...(dto.crmAssistantModel && {
        crmAssistantModel: dto.crmAssistantModel,
      }),
      ...(dto.whatsappReplyModel && {
        whatsappReplyModel: dto.whatsappReplyModel,
      }),
      ...(dto.whatsappSentimentModel && {
        whatsappSentimentModel: dto.whatsappSentimentModel,
      }),
      ...(dto.monthlyQuotaUsd !== undefined && {
        monthlyQuotaUsd: dto.monthlyQuotaUsd,
      }),
      ...(dto.agentModeEnabled !== undefined && {
        agentModeEnabled: dto.agentModeEnabled,
      }),
      ...(dto.aiEnabled !== undefined && { aiEnabled: dto.aiEnabled }),
      ...(dto.agentsEnabled !== undefined && {
        agentsEnabled: dto.agentsEnabled,
      }),
      ...(dto.memoryEnabled !== undefined && {
        memoryEnabled: dto.memoryEnabled,
      }),
      ...(dto.autopilotEnabled !== undefined && {
        autopilotEnabled: dto.autopilotEnabled,
      }),
      ...(dto.usageWeeklyEmailEnabled !== undefined && {
        usageWeeklyEmailEnabled: dto.usageWeeklyEmailEnabled,
      }),
      ...(dto.mcpWriteEnabled !== undefined && {
        mcpWriteEnabled: dto.mcpWriteEnabled,
      }),
      ...(dto.agentModel !== undefined && { agentModel: dto.agentModel }),
      ...(dto.failoverEnabled !== undefined && {
        failoverEnabled: dto.failoverEnabled,
      }),
    }

    // Só barra provedor sem chave no que está sendo alterado agora: um
    // modelo já salvo continua salvo se a chave sumir depois (a resolução
    // em runtime pula provedores indisponíveis).
    const touched = [
      ...(dto.enabledModels ?? []).filter(
        (key) => !current.value.enabledModels.includes(key),
      ),
      dto.crmAssistantModel,
      dto.whatsappReplyModel,
      dto.whatsappSentimentModel,
      dto.agentModel,
    ].filter((key): key is AiModelKey => Boolean(key))
    for (const key of touched) {
      const model = findAiModel(key)
      if (model && !isAiProviderConfigured(model.provider)) {
        return err(
          aiProviderUnavailable(
            `${AI_PROVIDER_LABELS[model.provider]} indisponível: a chave de API não está configurada na plataforma`,
          ),
        )
      }
    }

    for (const [feature, field] of Object.entries(
      AI_FEATURE_SETTING_FIELDS,
    ) as [AiFeature, (typeof AI_FEATURE_SETTING_FIELDS)[AiFeature]][]) {
      if (!next.enabledModels.includes(next[field])) {
        return err(
          validationError(
            `O modelo padrão de "${AI_FEATURE_LABELS[feature]}" precisa estar entre os habilitados`,
          ),
        )
      }
    }

    if (next.agentModel && !next.enabledModels.includes(next.agentModel)) {
      return err(
        validationError(
          'O modelo dos Steel Agents precisa estar entre os habilitados',
        ),
      )
    }

    const saved = await WorkspaceAiSettingsRepository.upsert(workspaceId, {
      enabledModels: next.enabledModels,
      crmAssistantModel: next.crmAssistantModel,
      whatsappReplyModel: next.whatsappReplyModel,
      whatsappSentimentModel: next.whatsappSentimentModel,
      monthlyQuotaUsd: next.monthlyQuotaUsd,
      agentModeEnabled: next.agentModeEnabled,
      aiEnabled: next.aiEnabled,
      agentsEnabled: next.agentsEnabled,
      memoryEnabled: next.memoryEnabled,
      autopilotEnabled: next.autopilotEnabled,
      usageWeeklyEmailEnabled: next.usageWeeklyEmailEnabled,
      mcpWriteEnabled: next.mcpWriteEnabled,
      agentModel: next.agentModel,
      failoverEnabled: next.failoverEnabled,
    })
    if (!saved.ok) return saved

    auditMutation({
      entity: 'workspace_ai_settings',
      action: 'update',
      actorId,
      targetId: saved.value.id,
      meta: {
        enabledModels: next.enabledModels,
        monthlyQuotaUsd: next.monthlyQuotaUsd,
        agentModeEnabled: next.agentModeEnabled,
        aiEnabled: next.aiEnabled,
        agentsEnabled: next.agentsEnabled,
        memoryEnabled: next.memoryEnabled,
        autopilotEnabled: next.autopilotEnabled,
        usageWeeklyEmailEnabled: next.usageWeeklyEmailEnabled,
        mcpWriteEnabled: next.mcpWriteEnabled,
        agentModel: next.agentModel,
        failoverEnabled: next.failoverEnabled,
        // Toggles flipped by this request (who turned what on or off).
        changedSwitches: (
          [
            'agentModeEnabled',
            'aiEnabled',
            'agentsEnabled',
            'memoryEnabled',
            'autopilotEnabled',
            'usageWeeklyEmailEnabled',
            'mcpWriteEnabled',
            'failoverEnabled',
          ] as const
        ).filter((key) => current.value[key] !== next[key]),
      },
    })
    // Knowledge index (ADR 0037): off purges it, on rebuilds it.
    if (current.value.aiEnabled !== next.aiEnabled) {
      void onWorkspaceAiSwitch(workspaceId, next.aiEnabled)
    }

    return buildDTO(
      actorId,
      workspaceId,
      toEffectiveAiSettings(saved.value),
      true,
    )
  },

  /**
   * Preferência pessoal do usuário. Nunca aceita modelo desabilitado no
   * workspace nem de provedor sem chave configurada.
   */
  async setUserPreference(
    actorId: string,
    workspaceId: string,
    dto: SetUserAiPreferenceDTO,
  ): Promise<Result<WorkspaceAiSettingsDTO>> {
    const membership = await assertMember(actorId, workspaceId)
    if (!membership.ok) return membership

    const settings = await loadEffective(workspaceId)
    if (!settings.ok) return settings

    if (dto.modelKey === null) {
      const removed = await UserAiPreferenceRepository.remove(
        workspaceId,
        actorId,
      )
      if (!removed.ok) return removed
    } else {
      if (!settings.value.enabledModels.includes(dto.modelKey)) {
        return err(aiModelNotEnabled())
      }
      const model = findAiModel(dto.modelKey)
      if (!model || !isAiProviderConfigured(model.provider)) {
        return err(aiProviderUnavailable())
      }
      const saved = await UserAiPreferenceRepository.upsert(
        workspaceId,
        actorId,
        dto.modelKey,
      )
      if (!saved.ok) return saved
    }

    auditMutation({
      entity: 'user_ai_preference',
      action: 'update',
      actorId,
      targetId: workspaceId,
      meta: { modelKey: dto.modelKey },
    })

    return buildDTO(
      actorId,
      workspaceId,
      settings.value,
      membership.value.isPrivileged,
    )
  },
}
