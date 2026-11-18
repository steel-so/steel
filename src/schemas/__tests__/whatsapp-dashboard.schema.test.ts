import { describe, expect, it } from 'vitest'
import { ChartConfigSchema, ViewConfigSchema } from '../crm-dashboard.schema'
import {
  WA_DASHBOARD_ROW_LIMITS,
  WA_DASHBOARD_SOURCES,
  WaDashboardSourceParamsSchema,
  WaDashboardSourceSchema,
} from '../whatsapp-dashboard.schema'

describe('WaDashboardSourceSchema', () => {
  it('should accept every Comunicação source and reject others', () => {
    for (const source of WA_DASHBOARD_SOURCES) {
      expect(WaDashboardSourceSchema.parse(source)).toBe(source)
      expect(WA_DASHBOARD_ROW_LIMITS[source]).toBeGreaterThan(0)
    }
    expect(WaDashboardSourceSchema.safeParse('sd-tickets').success).toBe(false)
    expect(
      WaDashboardSourceParamsSchema.safeParse({
        source: 'whatsapp-ai-campaign-recipients',
      }).success,
    ).toBe(true)
  })

  it('should be accepted as a source by charts and tables', () => {
    for (const source of WA_DASHBOARD_SOURCES) {
      expect(
        ChartConfigSchema.parse({ chartType: 'pie', source, xField: 'x' })
          .source,
      ).toBe(source)
      expect(ViewConfigSchema.parse({ source }).source).toBe(source)
    }
  })
})
