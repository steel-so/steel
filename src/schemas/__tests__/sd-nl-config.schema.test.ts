import { describe, expect, it } from 'vitest'
import {
  createFakeAutomationConfig,
  createFakeEscalationConfig,
  createFakeSlaConfig,
} from '@/src/__tests__/factories/nov-sd-nl-config.factory'
import {
  SD_NL_CONFIG_JSON_SCHEMA,
  SdNlConfigApplySchema,
  SdNlConfigModelOutputSchema,
  SdNlConfigPreviewSchema,
} from '../sd-nl-config.schema'

describe('SdNlConfigPreviewSchema', () => {
  it('trims and bounds the description', () => {
    expect(
      SdNlConfigPreviewSchema.parse({ kind: 'SLA', text: '  SLA de 4h  ' })
        .text,
    ).toBe('SLA de 4h')
    expect(
      SdNlConfigPreviewSchema.safeParse({ kind: 'SLA', text: 'abc' }).success,
    ).toBe(false)
    expect(
      SdNlConfigPreviewSchema.safeParse({ kind: 'X', text: 'abcdef' }).success,
    ).toBe(false)
    expect(
      SdNlConfigPreviewSchema.safeParse({
        kind: 'SLA',
        text: 'a'.repeat(2001),
      }).success,
    ).toBe(false)
  })
})

describe('SdNlConfigApplySchema', () => {
  it('validates the config with the creation schema of each kind', () => {
    for (const [kind, config] of [
      ['SLA', createFakeSlaConfig()],
      ['AUTOMATION', createFakeAutomationConfig()],
      ['ESCALATION', createFakeEscalationConfig()],
    ] as const) {
      expect(SdNlConfigApplySchema.safeParse({ kind, config }).success).toBe(
        true,
      )
    }
  })

  it('rejects an invalid config', () => {
    expect(
      SdNlConfigApplySchema.safeParse({
        kind: 'AUTOMATION',
        config: createFakeAutomationConfig({ actions: [] }),
      }).success,
    ).toBe(false)
    expect(
      SdNlConfigApplySchema.safeParse({
        kind: 'ESCALATION',
        config: createFakeEscalationConfig({
          trigger: 'NO_UPDATE',
          thresholdMinutes: null,
        }),
      }).success,
    ).toBe(false)
  })
})

describe('model output', () => {
  it('requires every envelope field, as the strict JSON schema does', () => {
    const ok = {
      understood: true,
      summary: 's',
      warnings: [],
      configJson: '{}',
    }
    expect(SdNlConfigModelOutputSchema.safeParse(ok).success).toBe(true)
    expect(
      SdNlConfigModelOutputSchema.safeParse({ ...ok, warnings: undefined })
        .success,
    ).toBe(false)
    expect(SD_NL_CONFIG_JSON_SCHEMA.required).toEqual(Object.keys(ok))
  })
})
