import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { AI_MODEL_CATALOG } from '@/src/lib/ai/models'
import {
  toAiModelPriceDTOs,
  toCostMargin,
  toPlatformAiSettingsDTO,
} from '../platform-ai-settings.mapper'

const row = {
  id: 'default',
  costMargin: new Prisma.Decimal('1.5'),
  embeddingsEnabled: true,
  updatedById: 'a',
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-06T00:00:00Z'),
}

describe('platform AI settings mapper', () => {
  it('should read the margin or fall back to 1', () => {
    expect(toCostMargin(null)).toBe(1)
    expect(toCostMargin(row)).toBe(1.5)
  })

  it('should list every catalog model with provider and charged prices', () => {
    const prices = toAiModelPriceDTOs(1.5)
    expect(prices).toHaveLength(AI_MODEL_CATALOG.length)
    expect(prices.find((p) => p.key === 'anthropic:claude-opus-5')).toEqual({
      key: 'anthropic:claude-opus-5',
      provider: 'anthropic',
      label: 'Claude Opus 5',
      inputUsdPer1M: 5,
      outputUsdPer1M: 25,
      cachedInputUsdPer1M: 0.5,
      chargedInputUsdPer1M: 7.5,
      chargedOutputUsdPer1M: 37.5,
    })
  })

  it('should build the DTO with and without a row', () => {
    expect(toPlatformAiSettingsDTO(row)).toMatchObject({
      costMargin: 1.5,
      updatedAt: '2026-10-06T00:00:00.000Z',
    })
    expect(toPlatformAiSettingsDTO(null)).toMatchObject({
      costMargin: 1,
      updatedAt: null,
    })
  })
})
