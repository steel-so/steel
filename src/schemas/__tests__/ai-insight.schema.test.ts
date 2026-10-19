import { describe, expect, it } from 'vitest'
import {
  AI_INSIGHT_DEFAULT_LIMIT,
  AI_INSIGHT_MAX_LIMIT,
  ListAiInsightsQuerySchema,
  UpdateAiDigestSettingsSchema,
  UpdateAiInsightSchema,
  WsInsightsToolArgsSchema,
} from '../ai-insight.schema'

describe('ListAiInsightsQuerySchema', () => {
  it('defaults to the active insights of every module', () => {
    expect(ListAiInsightsQuerySchema.parse({})).toEqual({
      state: 'active',
      limit: AI_INSIGHT_DEFAULT_LIMIT,
    })
  })

  it('coerces the limit from the query string and bounds it', () => {
    expect(
      ListAiInsightsQuerySchema.parse({
        state: 'snoozed',
        module: 'CRM',
        limit: '5',
      }),
    ).toEqual({ state: 'snoozed', module: 'CRM', limit: 5 })
    expect(
      ListAiInsightsQuerySchema.safeParse({ limit: AI_INSIGHT_MAX_LIMIT + 1 })
        .success,
    ).toBe(false)
    expect(ListAiInsightsQuerySchema.safeParse({ limit: 0 }).success).toBe(
      false,
    )
  })

  it('rejects unknown states and modules', () => {
    expect(ListAiInsightsQuerySchema.safeParse({ state: 'gone' }).success).toBe(
      false,
    )
    expect(
      ListAiInsightsQuerySchema.safeParse({ module: 'OTHER' }).success,
    ).toBe(false)
  })
})

describe('UpdateAiInsightSchema', () => {
  it('accepts dismiss, restore and a bounded snooze', () => {
    expect(UpdateAiInsightSchema.parse({ action: 'dismiss' })).toEqual({
      action: 'dismiss',
    })
    expect(UpdateAiInsightSchema.parse({ action: 'restore' })).toEqual({
      action: 'restore',
    })
    expect(UpdateAiInsightSchema.parse({ action: 'snooze', hours: 4 })).toEqual(
      { action: 'snooze', hours: 4 },
    )
  })

  it('rejects a snooze without hours or beyond a week', () => {
    for (const body of [
      { action: 'snooze' },
      { action: 'snooze', hours: 0 },
      { action: 'snooze', hours: 169 },
      { action: 'snooze', hours: 1.5 },
      { action: 'delete' },
    ]) {
      expect(UpdateAiInsightSchema.safeParse(body).success).toBe(false)
    }
  })
})

describe('UpdateAiDigestSettingsSchema', () => {
  it('needs at least one channel', () => {
    expect(UpdateAiDigestSettingsSchema.parse({ email: false })).toEqual({
      email: false,
    })
    expect(
      UpdateAiDigestSettingsSchema.parse({ inApp: true, email: true }),
    ).toEqual({ inApp: true, email: true })
    const empty = UpdateAiDigestSettingsSchema.safeParse({})
    expect(empty.success).toBe(false)
    expect(empty.error?.issues[0].message).toBe('Informe ao menos um canal')
    expect(
      UpdateAiDigestSettingsSchema.safeParse({ inApp: 'sim' }).success,
    ).toBe(false)
  })
})

describe('WsInsightsToolArgsSchema', () => {
  it('accepts an optional module and limit, nothing else', () => {
    expect(WsInsightsToolArgsSchema.parse({})).toEqual({})
    expect(
      WsInsightsToolArgsSchema.parse({ module: 'SERVICE_DESK', limit: 3 }),
    ).toEqual({ module: 'SERVICE_DESK', limit: 3 })
    expect(WsInsightsToolArgsSchema.safeParse({ extra: 1 }).success).toBe(false)
    expect(WsInsightsToolArgsSchema.safeParse({ limit: 21 }).success).toBe(
      false,
    )
  })
})
