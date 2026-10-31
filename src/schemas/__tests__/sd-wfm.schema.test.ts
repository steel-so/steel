import { describe, expect, it } from 'vitest'
import {
  SdWfmForecastQuerySchema,
  UpdateSdWfmSettingsSchema,
} from '../sd-wfm.schema'

describe('UpdateSdWfmSettingsSchema', () => {
  it('accepts a partial update', () => {
    expect(
      UpdateSdWfmSettingsSchema.safeParse({ historyWeeks: 8 }).success,
    ).toBe(true)
    expect(UpdateSdWfmSettingsSchema.safeParse({}).success).toBe(true)
  })

  it('accepts a shift that crosses midnight', () => {
    const parsed = UpdateSdWfmSettingsSchema.safeParse({
      shifts: [{ name: 'Noite', startHour: 22, endHour: 6 }],
    })
    expect(parsed.success).toBe(true)
  })

  it.each([
    { historyWeeks: 1 },
    { historyWeeks: 27 },
    { ticketsPerAgentHour: 0 },
    { targetOccupancyPercent: 5 },
    { minAgentsPerShift: -1 },
    { shifts: [] },
    { shifts: [{ name: 'x', startHour: 6, endHour: 6 }] },
    { shifts: [{ name: '', startHour: 6, endHour: 8 }] },
    { shifts: [{ name: 'x', startHour: 24, endHour: 8 }] },
  ])('rejects %j', (body) => {
    expect(UpdateSdWfmSettingsSchema.safeParse(body).success).toBe(false)
  })
})

describe('SdWfmForecastQuerySchema', () => {
  it('takes an optional department', () => {
    expect(SdWfmForecastQuerySchema.parse({})).toEqual({})
    expect(SdWfmForecastQuerySchema.parse({ departmentId: 'd1' })).toEqual({
      departmentId: 'd1',
    })
    expect(
      SdWfmForecastQuerySchema.safeParse({ departmentId: '' }).success,
    ).toBe(false)
  })
})
