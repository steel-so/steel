import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { createFakeWorkspaceAiSettings } from '@/src/__tests__/factories/ai-settings.factory'
import { AI_MODEL_CATALOG } from '@/src/lib/ai/models'
import {
  toEffectiveAiSettings,
  toWorkspaceAiSettingsDTO,
} from '../ai-settings.mapper'

describe('toEffectiveAiSettings()', () => {
  it('should fall back to platform defaults when there is no row', () => {
    expect(toEffectiveAiSettings(null)).toEqual({
      enabledModels: AI_MODEL_CATALOG.map((m) => m.key),
      crmAssistantModel: 'openai:gpt-4o-mini',
      whatsappReplyModel: 'openai:gpt-4o-mini',
      whatsappSentimentModel: 'openai:gpt-4o-mini',
      monthlyQuotaUsd: 50,
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
    })
  })

  it('should start a workspace without a row from the platform task defaults', () => {
    const settings = toEffectiveAiSettings(null, {
      taskModels: {
        CLASSIFICATION: 'anthropic:claude-haiku-4-5',
        CONVERSATION: null,
        ASSISTANT: 'anthropic:claude-sonnet-5',
        AGENT: 'anthropic:claude-opus-5',
      },
      failoverEnabled: true,
    })
    expect(settings.whatsappSentimentModel).toBe('anthropic:claude-haiku-4-5')
    expect(settings.whatsappReplyModel).toBe('openai:gpt-4o-mini')
    expect(settings.crmAssistantModel).toBe('anthropic:claude-sonnet-5')
    // The agent default is resolved at call time, not frozen here.
    expect(settings.agentModel).toBeNull()
  })

  it('should carry the agent model and the failover switch from the row', () => {
    const settings = toEffectiveAiSettings(
      createFakeWorkspaceAiSettings({
        agentModel: 'anthropic:claude-opus-5',
        failoverEnabled: false,
      }),
    )
    expect(settings.agentModel).toBe('anthropic:claude-opus-5')
    expect(settings.failoverEnabled).toBe(false)
    expect(
      toEffectiveAiSettings(
        createFakeWorkspaceAiSettings({ agentModel: 'retired:model' }),
      ).agentModel,
    ).toBeNull()
    expect(
      toWorkspaceAiSettingsDTO({
        workspaceId: 'ws1',
        settings,
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        periodStart: new Date('2026-10-01T00:00:00Z'),
        userPreference: null,
        canManage: true,
        isProviderAvailable: () => true,
      }),
    ).toMatchObject({
      agentModel: 'anthropic:claude-opus-5',
      failoverEnabled: false,
    })
  })

  it('should carry the MCP write switch from the row and into the DTO', () => {
    const settings = toEffectiveAiSettings(
      createFakeWorkspaceAiSettings({ mcpWriteEnabled: true }),
    )
    expect(settings.mcpWriteEnabled).toBe(true)
    expect(
      toWorkspaceAiSettingsDTO({
        workspaceId: 'ws1',
        settings,
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        periodStart: new Date('2026-10-01T00:00:00Z'),
        userPreference: null,
        canManage: true,
        isProviderAvailable: () => true,
      }).mcpWriteEnabled,
    ).toBe(true)
  })

  it('should carry the agent mode switch from the row', () => {
    expect(
      toEffectiveAiSettings(
        createFakeWorkspaceAiSettings({ agentModeEnabled: false }),
      ).agentModeEnabled,
    ).toBe(false)
  })

  it('should carry the Steel AI switches from the row', () => {
    expect(
      toEffectiveAiSettings(
        createFakeWorkspaceAiSettings({
          aiEnabled: false,
          agentsEnabled: false,
          memoryEnabled: false,
          autopilotEnabled: true,
          usageWeeklyEmailEnabled: false,
        }),
      ),
    ).toMatchObject({
      aiEnabled: false,
      agentsEnabled: false,
      memoryEnabled: false,
      autopilotEnabled: true,
      usageWeeklyEmailEnabled: false,
    })
  })

  it('should convert decimals and drop models no longer in the catalog', () => {
    const effective = toEffectiveAiSettings(
      createFakeWorkspaceAiSettings({
        enabledModels: ['openai:gpt-4o-mini', 'openai:retired-model'],
        crmAssistantModel: 'openai:retired-model',
        monthlyQuotaUsd: new Prisma.Decimal('120.50'),
        usdPer1kTokens: new Prisma.Decimal('4.0000'),
      }),
    )
    expect(effective.enabledModels).toEqual(['openai:gpt-4o-mini'])
    expect(effective.crmAssistantModel).toBe('openai:gpt-4o-mini')
    expect(effective.monthlyQuotaUsd).toBe(120.5)
    // The legacy fixed rule column is not read anymore (ADR 0019).
    expect(effective).not.toHaveProperty('usdPer1kTokens')
  })
})

describe('toWorkspaceAiSettingsDTO()', () => {
  const base = {
    workspaceId: 'ws1',
    settings: toEffectiveAiSettings(
      createFakeWorkspaceAiSettings({
        enabledModels: ['openai:gpt-4o-mini', 'anthropic:claude-sonnet-5'],
      }),
    ),
    periodStart: new Date('2026-09-01T00:00:00Z'),
    userPreference: 'anthropic:claude-sonnet-5',
    canManage: false,
    isProviderAvailable: (p: string) => p === 'openai',
  }

  it('should flag provider availability and enabled models', () => {
    const dto = toWorkspaceAiSettingsDTO({
      ...base,
      usage: { inputTokens: 1000, outputTokens: 500, costUsd: 6 },
    })

    expect(dto.providers).toEqual([
      { id: 'openai', label: 'OpenAI', available: true },
      { id: 'anthropic', label: 'Anthropic (Claude)', available: false },
    ])
    const sonnet = dto.models.find((m) => m.key === 'anthropic:claude-sonnet-5')
    expect(sonnet).toEqual(
      expect.objectContaining({ available: false, enabled: true }),
    )
    const opus = dto.models.find((m) => m.key === 'anthropic:claude-opus-5')
    expect(opus?.enabled).toBe(false)
    expect(dto.userPreference).toBe('anthropic:claude-sonnet-5')
    expect(dto.canManage).toBe(false)
    // At cost by default: provider prices per 1M tokens.
    expect(sonnet).toMatchObject({ inputUsdPer1M: 2, outputUsdPer1M: 10 })
  })

  it('should charge model prices with the platform margin', () => {
    const dto = toWorkspaceAiSettingsDTO({
      ...base,
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      costMargin: 1.5,
    })
    const mini = dto.models.find((m) => m.key === 'openai:gpt-4o-mini')
    expect(mini).toMatchObject({ inputUsdPer1M: 0.225, outputUsdPer1M: 0.9 })
  })

  it('should summarize consumption against the quota', () => {
    const dto = toWorkspaceAiSettingsDTO({
      ...base,
      usage: { inputTokens: 1000, outputTokens: 500, costUsd: 6.004 },
    })
    expect(dto.usage).toEqual({
      periodStart: '2026-09-01T00:00:00.000Z',
      inputTokens: 1000,
      outputTokens: 500,
      usedUsd: 6,
      remainingUsd: 44,
      exceeded: false,
    })
  })

  it('should mark the quota as exceeded', () => {
    const dto = toWorkspaceAiSettingsDTO({
      ...base,
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 50 },
    })
    expect(dto.usage.exceeded).toBe(true)
    expect(dto.usage.remainingUsd).toBe(0)
  })
})
