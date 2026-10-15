import { describe, expect, it } from 'vitest'
import {
  createFakeCrmDashboard,
  createFakeCrmDashboardWidget,
} from '@/src/__tests__/factories/crm-dashboard.factory'
import {
  toCrmDashboardDTO,
  toCrmDashboardTvLinkDTO,
  toCrmDashboardWidgetDTO,
} from '../crm-dashboard.mapper'

describe('toCrmDashboardTvLinkDTO()', () => {
  it('exposes the TV path and ISO dates', () => {
    const createdAt = new Date('2026-10-15T15:00:00.000Z')
    const dto = toCrmDashboardTvLinkDTO({
      id: 'l1',
      workspaceId: 'ws1',
      dashboardId: 'd1',
      token: 'abc',
      name: 'TV',
      createdById: 'u1',
      lastUsedAt: createdAt,
      revokedAt: null,
      createdAt,
    })
    expect(dto).toEqual({
      id: 'l1',
      dashboardId: 'd1',
      name: 'TV',
      path: '/tv/abc',
      createdById: 'u1',
      lastUsedAt: '2026-10-15T15:00:00.000Z',
      revokedAt: null,
      createdAt: '2026-10-15T15:00:00.000Z',
    })
    expect(
      toCrmDashboardTvLinkDTO({
        id: 'l2',
        workspaceId: 'ws1',
        dashboardId: 'd1',
        token: 'x',
        name: 'TV',
        createdById: 'u1',
        lastUsedAt: null,
        revokedAt: createdAt,
        createdAt,
      }),
    ).toMatchObject({ lastUsedAt: null, revokedAt: '2026-10-15T15:00:00.000Z' })
  })
})

describe('screens on dashboards and widgets', () => {
  it('maps settings (with defaults) and the widget page', () => {
    expect(toCrmDashboardDTO(createFakeCrmDashboard()).settings).toEqual({
      pages: ['Tela 1'],
      rotateSeconds: 0,
    })
    expect(
      toCrmDashboardWidgetDTO(createFakeCrmDashboardWidget({ page: 2 })).page,
    ).toBe(2)
  })
})
