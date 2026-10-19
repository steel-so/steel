import { describe, expect, it } from 'vitest'
import { UpdatePlatformAiSettingsSchema } from '../platform-ai-settings.schema'

describe('UpdatePlatformAiSettingsSchema', () => {
  it('should accept a margin within bounds and coerce strings', () => {
    expect(
      UpdatePlatformAiSettingsSchema.parse({
        costMargin: '1.3',
        reason: ' x ',
      }),
    ).toEqual({ costMargin: 1.3, reason: 'x' })
    expect(UpdatePlatformAiSettingsSchema.parse({ costMargin: 1 })).toEqual({
      costMargin: 1,
    })
  })

  it('should reject margins out of bounds and long reasons', () => {
    expect(
      UpdatePlatformAiSettingsSchema.safeParse({ costMargin: 0 }).success,
    ).toBe(false)
    expect(
      UpdatePlatformAiSettingsSchema.safeParse({ costMargin: 101 }).success,
    ).toBe(false)
    expect(
      UpdatePlatformAiSettingsSchema.safeParse({
        costMargin: 1,
        reason: 'x'.repeat(501),
      }).success,
    ).toBe(false)
    expect(UpdatePlatformAiSettingsSchema.safeParse({}).success).toBe(false)
  })
})

describe('UpdatePlatformAiSettingsSchema — routing (ADR 0042)', () => {
  it('should accept task models, null to reset, and the failover switch', () => {
    const parsed = UpdatePlatformAiSettingsSchema.safeParse({
      costMargin: 1,
      taskModels: { CLASSIFICATION: 'openai:gpt-4o-mini', AGENT: null },
      failoverEnabled: false,
    })
    expect(parsed.success).toBe(true)
    expect(parsed.data?.taskModels).toEqual({
      CLASSIFICATION: 'openai:gpt-4o-mini',
      AGENT: null,
    })
  })

  it('should reject a model outside the catalog', () => {
    const parsed = UpdatePlatformAiSettingsSchema.safeParse({
      costMargin: 1,
      taskModels: { ASSISTANT: 'openai:gpt-3' },
    })
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0].message).toBe('Modelo de IA desconhecido')
  })
})
