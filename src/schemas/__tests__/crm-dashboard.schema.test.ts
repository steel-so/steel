import { describe, expect, it } from 'vitest'
import {
  ChartConfigSchema,
  CreateCrmDashboardSchema,
  CreateCrmDashboardWidgetSchema,
  IframeConfigSchema,
  RichTextConfigSchema,
  UpdateCrmDashboardSchema,
  UpdateCrmDashboardWidgetSchema,
  ViewConfigSchema,
  widgetConfigSchema,
} from '../crm-dashboard.schema'

describe('CreateCrmDashboardSchema', () => {
  it('should reject when title is missing', () => {
    expect(CreateCrmDashboardSchema.safeParse({}).success).toBe(false)
  })
})

describe('UpdateCrmDashboardSchema', () => {
  it('should accept an empty payload', () => {
    expect(UpdateCrmDashboardSchema.safeParse({}).success).toBe(true)
  })
})

describe('CreateCrmDashboardWidgetSchema', () => {
  it('should apply layout defaults for a CHART widget', () => {
    const result = CreateCrmDashboardWidgetSchema.safeParse({
      type: 'CHART',
      config: { chartType: 'vertical' },
    })
    expect(result.success).toBe(true)
    expect(result.data?.w).toBe(4)
    expect(result.data?.h).toBe(6)
  })

  it('should reject a CHART widget missing config', () => {
    expect(
      CreateCrmDashboardWidgetSchema.safeParse({ type: 'CHART' }).success,
    ).toBe(false)
  })

  it('should reject an invalid type', () => {
    expect(
      CreateCrmDashboardWidgetSchema.safeParse({
        type: 'INVALID',
        config: {},
      }).success,
    ).toBe(false)
  })

  it('should accept a VIEW widget with a valid source', () => {
    expect(
      CreateCrmDashboardWidgetSchema.safeParse({
        type: 'VIEW',
        config: { source: 'companies' },
      }).success,
    ).toBe(true)
  })

  it('should reject a VIEW widget with an invalid source', () => {
    expect(
      CreateCrmDashboardWidgetSchema.safeParse({
        type: 'VIEW',
        config: { source: 'invoices' },
      }).success,
    ).toBe(false)
  })

  it('should accept an IFRAME widget with a valid url', () => {
    expect(
      CreateCrmDashboardWidgetSchema.safeParse({
        type: 'IFRAME',
        config: { url: 'https://example.com' },
      }).success,
    ).toBe(true)
  })

  it('should reject an IFRAME widget with an invalid url', () => {
    expect(
      CreateCrmDashboardWidgetSchema.safeParse({
        type: 'IFRAME',
        config: { url: 'not-a-url' },
      }).success,
    ).toBe(false)
  })

  it('should default RICH_TEXT html to empty string', () => {
    const result = CreateCrmDashboardWidgetSchema.safeParse({
      type: 'RICH_TEXT',
      config: {},
    })
    expect(result.success).toBe(true)
    if (result.success && result.data.type === 'RICH_TEXT') {
      expect(result.data.config.html).toBe('')
    }
  })
})

describe('UpdateCrmDashboardWidgetSchema', () => {
  it('should accept a partial layout update', () => {
    expect(UpdateCrmDashboardWidgetSchema.safeParse({ x: 2 }).success).toBe(
      true,
    )
  })

  it('should reject an empty payload', () => {
    expect(UpdateCrmDashboardWidgetSchema.safeParse({}).success).toBe(false)
  })
})

describe('widgetConfigSchema()', () => {
  it('should resolve the correct schema per widget type', () => {
    expect(widgetConfigSchema('CHART')).toBe(ChartConfigSchema)
    expect(widgetConfigSchema('VIEW')).toBe(ViewConfigSchema)
    expect(widgetConfigSchema('IFRAME')).toBe(IframeConfigSchema)
    expect(widgetConfigSchema('RICH_TEXT')).toBe(RichTextConfigSchema)
  })
})

describe('ChartConfigSchema funnel', () => {
  it('should accept the funnel chart type', () => {
    const result = ChartConfigSchema.safeParse({
      chartType: 'funnel',
      source: 'opportunities',
      xField: 'stageId',
    })
    expect(result.success).toBe(true)
    expect(result.data?.chartType).toBe('funnel')
  })
})
