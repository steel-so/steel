import { createId } from '@paralleldrive/cuid2'
import {
  type AiUsage,
  Prisma,
  type UserAiPreference,
  type WorkspaceAiSettings,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'

export function createFakeWorkspaceAiSettings(
  overrides?: Partial<WorkspaceAiSettings>,
): WorkspaceAiSettings {
  const now = new Date()
  return {
    id: createId(),
    workspaceId: createId(),
    enabledModels: ['openai:gpt-4o-mini', 'anthropic:claude-sonnet-5'],
    crmAssistantModel: 'openai:gpt-4o-mini',
    whatsappReplyModel: 'openai:gpt-4o-mini',
    whatsappSentimentModel: 'openai:gpt-4o-mini',
    monthlyQuotaUsd: new Prisma.Decimal(50),
    usdPer1kTokens: new Prisma.Decimal(4),
    agentModeEnabled: true,
    aiEnabled: true,
    agentsEnabled: true,
    memoryEnabled: true,
    autopilotEnabled: false,
    usageWeeklyEmailEnabled: true,
    mcpWriteEnabled: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function createFakeUserAiPreference(
  overrides?: Partial<UserAiPreference>,
): UserAiPreference {
  const now = new Date()
  return {
    id: createId(),
    workspaceId: createId(),
    userId: createId(),
    modelKey: 'anthropic:claude-sonnet-5',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function createFakeAiUsage(overrides?: Partial<AiUsage>): AiUsage {
  return {
    id: createId(),
    workspaceId: createId(),
    userId: null,
    feature: 'CRM_ASSISTANT',
    provider: 'openai',
    model: 'gpt-4o-mini',
    inputTokens: 100,
    outputTokens: 50,
    costUsd: new Prisma.Decimal(0.6),
    module: null,
    conversationId: null,
    agentRunId: null,
    createdAt: new Date(),
    ...overrides,
  }
}

export async function seedWorkspaceAiSettings(
  workspaceId: string,
  overrides?: Partial<
    Omit<Prisma.WorkspaceAiSettingsUncheckedCreateInput, 'workspaceId'>
  >,
) {
  return prisma.workspaceAiSettings.create({
    data: {
      workspaceId,
      enabledModels: ['openai:gpt-4o-mini', 'anthropic:claude-sonnet-5'],
      crmAssistantModel: 'openai:gpt-4o-mini',
      whatsappReplyModel: 'openai:gpt-4o-mini',
      whatsappSentimentModel: 'openai:gpt-4o-mini',
      ...overrides,
    },
  })
}

export async function seedAiUsage(
  workspaceId: string,
  overrides?: Partial<Omit<Prisma.AiUsageUncheckedCreateInput, 'workspaceId'>>,
) {
  return prisma.aiUsage.create({
    data: {
      workspaceId,
      feature: 'CRM_ASSISTANT',
      provider: 'openai',
      model: 'gpt-4o-mini',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.6,
      ...overrides,
    },
  })
}
