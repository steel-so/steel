import { describe, expect, it, vi } from 'vitest'
import { createFakeWorkspaceAiSettings } from '@/src/__tests__/factories/ai-settings.factory'
import { expectOk } from '@/src/__tests__/helpers/result.helpers'
import { ok } from '@/src/lib/result'

type GuardedModule = typeof import('@/src/lib/ai/guardrails/guarded-provider')

vi.mock('@/src/services/platform-notifications')
vi.mock('@/src/services/platform-ai-settings.service', () => ({
  PlatformAiSettingsService: {
    getCostMargin: vi.fn(async () => 1),
    getRoutingDefaults: vi.fn(async () => ({
      taskModels: {
        CLASSIFICATION: null,
        CONVERSATION: null,
        ASSISTANT: null,
        AGENT: null,
      },
      failoverEnabled: true,
    })),
  },
}))
vi.mock('@/src/repositories/ai-settings.repository')
vi.mock('@/src/repositories/ai-guardrails.repository')
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/ai')>()),
  isAiProviderConfigured: vi.fn(() => true),
  getAiProvider: vi.fn((provider: string) => ({ id: provider, chat: vi.fn() })),
}))
vi.mock('@/src/lib/ai/guardrails/guarded-provider', async (importOriginal) => {
  const actual = await importOriginal<GuardedModule>()
  return {
    ...actual,
    createGuardedProvider: vi.fn(actual.createGuardedProvider),
  }
})

import { createGuardedProvider } from '@/src/lib/ai/guardrails/guarded-provider'
import { AI_TASK_TIMEOUT_MS } from '@/src/lib/ai/models'
import { WorkspaceAiGuardrailsRepository } from '@/src/repositories/ai-guardrails.repository'
import {
  AiUsageRepository,
  UserAiPreferenceRepository,
  WorkspaceAiSettingsRepository,
} from '@/src/repositories/ai-settings.repository'
import { AiUsageService } from '../ai-usage.service'

const guarded = vi.mocked(createGuardedProvider)

function setup() {
  vi.mocked(WorkspaceAiSettingsRepository.findByWorkspace).mockResolvedValue(
    ok(createFakeWorkspaceAiSettings()),
  )
  vi.mocked(UserAiPreferenceRepository.find).mockResolvedValue(ok(null))
  vi.mocked(AiUsageRepository.sumSince).mockResolvedValue(
    ok({ inputTokens: 0, outputTokens: 0, costUsd: 0 }),
  )
  vi.mocked(WorkspaceAiGuardrailsRepository.findByWorkspace).mockResolvedValue(
    ok(null),
  )
}

describe('AiUsageService.prepare() first-chunk timeout', () => {
  it('should use the task class timeout by default', async () => {
    setup()

    expectOk(await AiUsageService.prepare('ws1', 'CRM_ASSISTANT', 'u1'))

    expect(guarded.mock.calls[0][0].timeoutMs).toBe(
      AI_TASK_TIMEOUT_MS.ASSISTANT,
    )
  })

  it('should honor a longer timeout for long background inputs', async () => {
    setup()

    expectOk(
      await AiUsageService.prepare('ws1', 'CRM_ASSISTANT', 'u1', [], {
        timeoutMs: 600_000,
      }),
    )

    expect(guarded.mock.calls[0][0].timeoutMs).toBe(600_000)
  })
})
