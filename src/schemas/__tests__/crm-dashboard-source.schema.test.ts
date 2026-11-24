import { describe, expect, it } from 'vitest'
import { ChartConfigSchema, ViewConfigSchema } from '../crm-dashboard.schema'
import {
  CRM_DASHBOARD_ROW_LIMITS,
  CRM_DASHBOARD_SOURCES,
  CrmDashboardSourceParamsSchema,
  CrmDashboardSourceSchema,
} from '../crm-dashboard-source.schema'

describe('CrmDashboardSourceSchema', () => {
  it('should accept every CRM source and reject others', () => {
    for (const source of CRM_DASHBOARD_SOURCES) {
      expect(CrmDashboardSourceSchema.parse(source)).toBe(source)
      expect(CRM_DASHBOARD_ROW_LIMITS[source]).toBeGreaterThan(0)
    }
    expect(CrmDashboardSourceSchema.safeParse('sd-tickets').success).toBe(false)
    expect(
      CrmDashboardSourceParamsSchema.safeParse({ source: 'crm-proposals' })
        .success,
    ).toBe(true)
  })

  it('should be accepted as a source by charts and tables', () => {
    for (const source of CRM_DASHBOARD_SOURCES) {
      expect(
        ChartConfigSchema.parse({ chartType: 'pie', source, xField: 'status' })
          .source,
      ).toBe(source)
      expect(ViewConfigSchema.parse({ source }).source).toBe(source)
    }
  })
})
