import { describe, expect, it } from 'vitest'
import {
  SetUserAiPreferenceSchema,
  UpdateWorkspaceAiSettingsSchema,
} from '../ai-settings.schema'

describe('UpdateWorkspaceAiSettingsSchema', () => {
  it('should accept an empty object (partial update)', () => {
    expect(UpdateWorkspaceAiSettingsSchema.safeParse({}).success).toBe(true)
  })

  it('should accept a full payload', () => {
    const result = UpdateWorkspaceAiSettingsSchema.safeParse({
      enabledModels: ['openai:gpt-4o-mini', 'anthropic:claude-sonnet-5'],
      crmAssistantModel: 'anthropic:claude-sonnet-5',
      whatsappReplyModel: 'openai:gpt-4o-mini',
      whatsappSentimentModel: 'openai:gpt-4o-mini',
      monthlyQuotaUsd: 120.5,
    })
    expect(result.success).toBe(true)
  })

  it('should accept the MCP write switch as a boolean only', () => {
    const parsed = UpdateWorkspaceAiSettingsSchema.safeParse({
      mcpWriteEnabled: true,
    })
    expect(parsed.success && parsed.data.mcpWriteEnabled).toBe(true)
    expect(
      UpdateWorkspaceAiSettingsSchema.safeParse({ mcpWriteEnabled: 'true' })
        .success,
    ).toBe(false)
  })

  it('should reject a model outside the catalog', () => {
    expect(
      UpdateWorkspaceAiSettingsSchema.safeParse({
        crmAssistantModel: 'openai:gpt-3',
      }).success,
    ).toBe(false)
  })

  it('should reject an empty enabled list', () => {
    expect(
      UpdateWorkspaceAiSettingsSchema.safeParse({ enabledModels: [] }).success,
    ).toBe(false)
  })

  it('should reject duplicated models', () => {
    expect(
      UpdateWorkspaceAiSettingsSchema.safeParse({
        enabledModels: ['openai:gpt-4o-mini', 'openai:gpt-4o-mini'],
      }).success,
    ).toBe(false)
  })

  it('should reject a negative quota', () => {
    expect(
      UpdateWorkspaceAiSettingsSchema.safeParse({ monthlyQuotaUsd: -1 })
        .success,
    ).toBe(false)
  })

  it('should reject a quota with more than two decimals', () => {
    expect(
      UpdateWorkspaceAiSettingsSchema.safeParse({ monthlyQuotaUsd: 1.234 })
        .success,
    ).toBe(false)
  })
})

describe('SetUserAiPreferenceSchema', () => {
  it('should accept a catalog model', () => {
    expect(
      SetUserAiPreferenceSchema.safeParse({
        modelKey: 'anthropic:claude-opus-5',
      }).success,
    ).toBe(true)
  })

  it('should accept null (follow workspace default)', () => {
    expect(
      SetUserAiPreferenceSchema.safeParse({ modelKey: null }).success,
    ).toBe(true)
  })

  it('should reject an unknown model', () => {
    expect(
      SetUserAiPreferenceSchema.safeParse({ modelKey: 'foo:bar' }).success,
    ).toBe(false)
  })
})

describe('UpdateWorkspaceAiSettingsSchema — task classes (ADR 0042)', () => {
  it('should accept the agent model (or null) and the failover switch', () => {
    expect(
      UpdateWorkspaceAiSettingsSchema.safeParse({
        agentModel: 'anthropic:claude-opus-5',
        failoverEnabled: false,
      }).success,
    ).toBe(true)
    expect(
      UpdateWorkspaceAiSettingsSchema.safeParse({ agentModel: null }).success,
    ).toBe(true)
    expect(
      UpdateWorkspaceAiSettingsSchema.safeParse({ agentModel: 'x:y' }).success,
    ).toBe(false)
    expect(
      UpdateWorkspaceAiSettingsSchema.safeParse({ failoverEnabled: 'yes' })
        .success,
    ).toBe(false)
  })
})
