import { type PlatformAiSettings, Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeUser } from '@/src/__tests__/factories/user.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/platform-ai-settings.repository')
vi.mock('@/src/repositories/user.repository')
vi.mock('@/src/lib/admin-audit', () => ({ persistAdminAction: vi.fn() }))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/repositories/ai-knowledge-chunk.repository')
vi.mock('@/src/lib/ai/knowledge/embeddings', () => ({
  isEmbeddingProviderConfigured: vi.fn(() => true),
}))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { auditMutation } from '@/lib/axiom/audit'
import { persistAdminAction } from '@/src/lib/admin-audit'
import { isEmbeddingProviderConfigured } from '@/src/lib/ai/knowledge/embeddings'
import { AiKnowledgeChunkRepository } from '@/src/repositories/ai-knowledge-chunk.repository'
import { PlatformAiSettingsRepository } from '@/src/repositories/platform-ai-settings.repository'
import { UserRepository } from '@/src/repositories/user.repository'
import {
  COST_MARGIN_TTL_MS,
  PlatformAiSettingsService,
} from '../platform-ai-settings.service'

const repo = vi.mocked(PlatformAiSettingsRepository)
const users = vi.mocked(UserRepository)
const chunks = vi.mocked(AiKnowledgeChunkRepository)

const admin = createFakeUser({
  id: 'admin1',
  isPlatformAdmin: true,
  email: 'admin@stratustelecom.com.br',
})
const regular = createFakeUser({ id: 'u1', email: 'user@example.com' })

function row(margin: string): PlatformAiSettings {
  return {
    id: 'default',
    costMargin: new Prisma.Decimal(margin),
    embeddingsEnabled: true,
    updatedById: 'admin1',
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-06T12:00:00Z'),
  }
}

beforeEach(() => {
  PlatformAiSettingsService.clearCache()
  users.findById.mockImplementation(async (id) =>
    ok(id === 'admin1' ? admin : regular),
  )
  repo.find.mockResolvedValue(ok(null))
  repo.upsert.mockImplementation(async (data) => ({
    ok: true,
    value: {
      ...row(String(data.costMargin)),
      embeddingsEnabled: data.embeddingsEnabled ?? true,
    },
  }))
  chunks.vectorEnabled.mockResolvedValue(ok(true))
  vi.mocked(isEmbeddingProviderConfigured).mockReturnValue(true)
})

describe('PlatformAiSettingsService.getCostMargin()', () => {
  it('should default to 1 without a row and cache the value', async () => {
    expect(await PlatformAiSettingsService.getCostMargin(0)).toBe(1)
    repo.find.mockResolvedValue(ok(row('1.5')))
    expect(await PlatformAiSettingsService.getCostMargin(1_000)).toBe(1)
    expect(repo.find).toHaveBeenCalledTimes(1)
  })

  it('should re-read after the TTL', async () => {
    repo.find.mockResolvedValue(ok(row('1.3')))
    expect(await PlatformAiSettingsService.getCostMargin(0)).toBe(1.3)
    repo.find.mockResolvedValue(ok(row('2')))
    expect(
      await PlatformAiSettingsService.getCostMargin(COST_MARGIN_TTL_MS + 1),
    ).toBe(2)
  })

  it('should keep the last value (or the default) on a database error', async () => {
    repo.find.mockResolvedValue(err(databaseError()))
    expect(await PlatformAiSettingsService.getCostMargin(0)).toBe(1)

    repo.find.mockResolvedValue(ok(row('1.8')))
    expect(await PlatformAiSettingsService.getCostMargin(0)).toBe(1.8)
    repo.find.mockResolvedValue(err(databaseError()))
    expect(
      await PlatformAiSettingsService.getCostMargin(COST_MARGIN_TTL_MS + 1),
    ).toBe(1.8)
  })
})

describe('PlatformAiSettingsService.get()', () => {
  it('should refuse anyone but a platform admin', async () => {
    expectErr(await PlatformAiSettingsService.get('u1'), 'FORBIDDEN')
    expect(repo.find).not.toHaveBeenCalled()
  })

  it('should return the margin and the model prices', async () => {
    repo.find.mockResolvedValue(ok(row('2')))
    const dto = expectOk(await PlatformAiSettingsService.get('admin1'))
    expect(dto.costMargin).toBe(2)
    expect(dto.updatedAt).toBe('2026-10-06T12:00:00.000Z')
    expect(dto.models.find((m) => m.key === 'openai:gpt-4o-mini')).toEqual(
      expect.objectContaining({
        inputUsdPer1M: 0.15,
        chargedInputUsdPer1M: 0.3,
        chargedOutputUsdPer1M: 1.2,
      }),
    )
  })

  it('should show defaults without a row and propagate db errors', async () => {
    const dto = expectOk(await PlatformAiSettingsService.get('admin1'))
    expect(dto).toMatchObject({ costMargin: 1, updatedAt: null })
    repo.find.mockResolvedValue(err(databaseError()))
    expectErr(await PlatformAiSettingsService.get('admin1'), 'DATABASE_ERROR')
  })
})

describe('PlatformAiSettingsService.update()', () => {
  it('should refuse anyone but a platform admin', async () => {
    expectErr(
      await PlatformAiSettingsService.update('u1', { costMargin: 3 }),
      'FORBIDDEN',
    )
    expect(repo.upsert).not.toHaveBeenCalled()
  })

  it('should save, audit twice and drop the cached margin', async () => {
    expect(await PlatformAiSettingsService.getCostMargin(0)).toBe(1)

    const dto = expectOk(
      await PlatformAiSettingsService.update('admin1', {
        costMargin: 1.25,
        reason: 'Impostos',
      }),
    )

    expect(dto.costMargin).toBe(1.25)
    expect(repo.upsert).toHaveBeenCalledWith({
      costMargin: 1.25,
      embeddingsEnabled: true,
      updatedById: 'admin1',
    })
    expect(auditMutation).toHaveBeenCalledWith({
      entity: 'platform_ai_settings',
      action: 'update',
      actorId: 'admin1',
      meta: { previousMargin: 1, costMargin: 1.25 },
    })
    expect(persistAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ai.cost_margin_update',
        targetType: 'platform',
        reason: 'Impostos',
      }),
    )
    repo.find.mockResolvedValue(ok(row('1.25')))
    expect(await PlatformAiSettingsService.getCostMargin(1)).toBe(1.25)
  })

  it('should record a null reason when none is given', async () => {
    expectOk(
      await PlatformAiSettingsService.update('admin1', { costMargin: 2 }),
    )
    expect(persistAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ reason: null }),
    )
  })

  it('should audit a failed write and return the error', async () => {
    repo.upsert.mockResolvedValue(err(databaseError()))
    expectErr(
      await PlatformAiSettingsService.update('admin1', { costMargin: 2 }),
      'DATABASE_ERROR',
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failure', reason: 'DATABASE_ERROR' }),
    )
  })

  it('should propagate a failure reading the current row', async () => {
    repo.find.mockResolvedValue(err(databaseError()))
    expectErr(
      await PlatformAiSettingsService.update('admin1', { costMargin: 2 }),
      'DATABASE_ERROR',
    )
    expect(repo.upsert).not.toHaveBeenCalled()
  })
})

describe('PlatformAiSettingsService — knowledge search embeddings', () => {
  it('should read the switch (default on), cache it and fail closed', async () => {
    expect(await PlatformAiSettingsService.getEmbeddingsEnabled(0)).toBe(true)
    repo.find.mockResolvedValue(ok({ ...row('1'), embeddingsEnabled: false }))
    expect(await PlatformAiSettingsService.getEmbeddingsEnabled(1_000)).toBe(
      true,
    )
    expect(
      await PlatformAiSettingsService.getEmbeddingsEnabled(
        COST_MARGIN_TTL_MS + 1,
      ),
    ).toBe(false)

    PlatformAiSettingsService.clearCache()
    repo.find.mockResolvedValue(err(databaseError()))
    expect(await PlatformAiSettingsService.getEmbeddingsEnabled(0)).toBe(false)
    repo.find.mockResolvedValue(ok(row('1')))
    expect(await PlatformAiSettingsService.getEmbeddingsEnabled(0)).toBe(true)
    repo.find.mockResolvedValue(err(databaseError()))
    expect(
      await PlatformAiSettingsService.getEmbeddingsEnabled(
        COST_MARGIN_TTL_MS + 1,
      ),
    ).toBe(true)
  })

  it('should report the live state of the knowledge search', async () => {
    expect(
      expectOk(await PlatformAiSettingsService.get('admin1')),
    ).toMatchObject({
      embeddingsEnabled: true,
      knowledgeSearch: {
        providerConfigured: true,
        vectorIndexReady: true,
        mode: 'hybrid',
      },
    })
    chunks.vectorEnabled.mockResolvedValue(err(databaseError()))
    expect(
      expectOk(await PlatformAiSettingsService.get('admin1')).knowledgeSearch,
    ).toEqual({
      providerConfigured: true,
      vectorIndexReady: false,
      mode: 'text',
    })
    chunks.vectorEnabled.mockResolvedValue(ok(true))
    vi.mocked(isEmbeddingProviderConfigured).mockReturnValue(false)
    expect(
      expectOk(await PlatformAiSettingsService.get('admin1')).knowledgeSearch
        .mode,
    ).toBe('text')
  })

  it('should switch embeddings off, audit the change and keep it otherwise', async () => {
    const dto = expectOk(
      await PlatformAiSettingsService.update('admin1', {
        costMargin: 1,
        embeddingsEnabled: false,
      }),
    )
    expect(dto.embeddingsEnabled).toBe(false)
    expect(dto.knowledgeSearch.mode).toBe('text')
    expect(repo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ embeddingsEnabled: false }),
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: {
          previousMargin: 1,
          costMargin: 1,
          previousEmbeddingsEnabled: true,
          embeddingsEnabled: false,
        },
      }),
    )

    repo.find.mockResolvedValue(ok({ ...row('1'), embeddingsEnabled: false }))
    expectOk(
      await PlatformAiSettingsService.update('admin1', { costMargin: 2 }),
    )
    expect(repo.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ embeddingsEnabled: false }),
    )
  })
})
