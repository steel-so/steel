import { describe, expect, it } from 'vitest'
import {
  CreateCrmDashboardFromTemplateSchema,
  CreateCrmDashboardTvLinkSchema,
  CreateCrmDashboardWidgetSchema,
  CrmDashboardSettingsSchema,
  CrmDashboardWidgetLayoutBatchSchema,
  parseDashboardSettings,
  UpdateCrmDashboardSchema,
  UpdateCrmDashboardWidgetSchema,
  widgetConfigSchema,
} from '@/src/schemas/crm-dashboard.schema'
import {
  SalesConfigSchema,
  SalesMetricSchema,
  SalesMetricsQuerySchema,
} from '@/src/schemas/crm-sales-metrics.schema'

describe('SalesConfigSchema', () => {
  it('fills the defaults', () => {
    expect(SalesConfigSchema.parse({ kind: 'goal' })).toEqual({
      kind: 'goal',
      period: 'month',
      stalledDays: 14,
    })
  })

  it('rejects unknown kinds and out-of-range numbers', () => {
    expect(SalesConfigSchema.safeParse({ kind: 'nope' }).success).toBe(false)
    expect(
      SalesConfigSchema.safeParse({ kind: 'stalled', stalledDays: 0 }).success,
    ).toBe(false)
    expect(
      SalesConfigSchema.safeParse({ kind: 'ranking', limit: 21 }).success,
    ).toBe(false)
    expect(
      SalesConfigSchema.safeParse({ kind: 'goal', period: 'year' }).success,
    ).toBe(false)
  })
})

describe('SalesMetricsQuerySchema', () => {
  it('coerces numbers from the query string', () => {
    expect(
      SalesMetricsQuerySchema.parse({
        kind: 'stalled',
        stalledDays: '30',
        limit: '5',
        pipelineId: 'p1',
      }),
    ).toEqual({
      kind: 'stalled',
      period: 'month',
      stalledDays: 30,
      limit: 5,
      pipelineId: 'p1',
    })
  })

  it('requires a kind', () => {
    expect(SalesMetricsQuerySchema.safeParse({}).success).toBe(false)
  })
})

describe('SalesMetricSchema', () => {
  it('parses each kind by its discriminator', () => {
    expect(
      SalesMetricSchema.parse({
        kind: 'scoreboard',
        day: '2026-10-15',
        winsToday: 1,
        amountToday: 10,
        meetingsToday: 0,
        activitiesToday: 0,
        newLeadsToday: 0,
        leadsBySource: [],
      }).kind,
    ).toBe('scoreboard')
    expect(SalesMetricSchema.safeParse({ kind: 'goal' }).success).toBe(false)
  })
})

describe('dashboard screens', () => {
  it('defaults to one screen without rotation', () => {
    expect(CrmDashboardSettingsSchema.parse({})).toEqual({
      pages: ['Tela 1'],
      rotateSeconds: 0,
    })
  })

  it('takes 1 to 3 screens and a rotation of 0 or 10–600 s', () => {
    expect(CrmDashboardSettingsSchema.safeParse({ pages: [] }).success).toBe(
      false,
    )
    expect(
      CrmDashboardSettingsSchema.safeParse({ pages: ['a', 'b', 'c', 'd'] })
        .success,
    ).toBe(false)
    expect(
      CrmDashboardSettingsSchema.safeParse({ rotateSeconds: 5 }).success,
    ).toBe(false)
    expect(
      CrmDashboardSettingsSchema.safeParse({ rotateSeconds: 601 }).success,
    ).toBe(false)
    expect(
      CrmDashboardSettingsSchema.safeParse({ rotateSeconds: 30 }).success,
    ).toBe(true)
  })

  it('parseDashboardSettings falls back on broken JSON', () => {
    expect(parseDashboardSettings(null)).toEqual({
      pages: ['Tela 1'],
      rotateSeconds: 0,
    })
    expect(parseDashboardSettings({ pages: 1 })).toEqual({
      pages: ['Tela 1'],
      rotateSeconds: 0,
    })
    expect(
      parseDashboardSettings({ pages: ['A', 'B'], rotateSeconds: 60 }),
    ).toEqual({
      pages: ['A', 'B'],
      rotateSeconds: 60,
    })
  })

  it('accepts settings in the dashboard update', () => {
    expect(
      UpdateCrmDashboardSchema.parse({ settings: { pages: ['A'] } }).settings,
    ).toEqual({ pages: ['A'], rotateSeconds: 0 })
  })
})

describe('sales widgets and screens on widgets', () => {
  it('creates a SALES widget on a screen', () => {
    const parsed = CreateCrmDashboardWidgetSchema.parse({
      type: 'SALES',
      config: { kind: 'ranking' },
      page: 2,
    })
    expect(parsed).toMatchObject({ type: 'SALES', page: 2, w: 4, h: 6 })
    expect(parsed.config).toMatchObject({ kind: 'ranking', period: 'month' })
  })

  it('leaves the screen to the database default and caps it at 3 screens', () => {
    expect(
      CreateCrmDashboardWidgetSchema.parse({ type: 'RICH_TEXT', config: {} })
        .page,
    ).toBeUndefined()
    expect(
      CreateCrmDashboardWidgetSchema.safeParse({
        type: 'RICH_TEXT',
        config: {},
        page: 3,
      }).success,
    ).toBe(false)
  })

  it('moves widgets between screens on update and layout', () => {
    expect(UpdateCrmDashboardWidgetSchema.parse({ page: 1 })).toEqual({
      page: 1,
    })
    expect(
      CrmDashboardWidgetLayoutBatchSchema.parse({
        items: [{ id: 'w', x: 0, y: 0, w: 1, h: 1, page: 2 }],
      }).items[0].page,
    ).toBe(2)
  })

  it('maps SALES to its config schema', () => {
    expect(widgetConfigSchema('SALES')).toBe(SalesConfigSchema)
  })
})

describe('TV links and templates', () => {
  it('names a TV link "TV" by default', () => {
    expect(CreateCrmDashboardTvLinkSchema.parse({})).toEqual({ name: 'TV' })
    expect(
      CreateCrmDashboardTvLinkSchema.safeParse({ name: '  ' }).success,
    ).toBe(false)
  })

  it('only knows the sales-tv template', () => {
    expect(
      CreateCrmDashboardFromTemplateSchema.parse({ template: 'sales-tv' }),
    ).toEqual({
      template: 'sales-tv',
    })
    expect(
      CreateCrmDashboardFromTemplateSchema.safeParse({ template: 'x' }).success,
    ).toBe(false)
  })
})
