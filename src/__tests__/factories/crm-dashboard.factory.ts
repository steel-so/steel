import { createId } from '@paralleldrive/cuid2'
import type { CrmDashboard, CrmDashboardWidget } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type {
  CrmDashboardDTO,
  CrmDashboardWidgetDTO,
} from '@/types/crm-dashboard'

export function createFakeCrmDashboard(
  overrides?: Partial<CrmDashboard>,
): CrmDashboard {
  const now = new Date()
  return {
    id: createId(),
    title: 'Visão geral',
    workspaceId: createId(),
    module: 'CRM',
    createdById: createId(),
    updatedById: null,
    position: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    settings: {},
    ...overrides,
  }
}

export function createFakeCrmDashboardDTO(
  overrides?: Partial<CrmDashboardDTO>,
): CrmDashboardDTO {
  const now = new Date().toISOString()
  return {
    id: createId(),
    title: 'Visão geral',
    workspaceId: createId(),
    module: 'CRM',
    createdById: createId(),
    updatedById: null,
    position: 0,
    settings: { pages: ['Tela 1'], rotateSeconds: 0 },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export async function seedCrmDashboard(
  workspaceId: string,
  createdById: string,
  overrides?: Partial<Pick<CrmDashboard, 'title' | 'position' | 'deletedAt'>>,
) {
  return prisma.crmDashboard.create({
    data: { title: 'Seed Dashboard', workspaceId, createdById, ...overrides },
  })
}

export function createFakeCrmDashboardWidget(
  overrides?: Partial<CrmDashboardWidget>,
): CrmDashboardWidget {
  const now = new Date()
  return {
    id: createId(),
    dashboardId: createId(),
    type: 'CHART',
    x: 0,
    y: 0,
    w: 4,
    h: 6,
    page: 0,
    config: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function createFakeCrmDashboardWidgetDTO(
  overrides?: Partial<CrmDashboardWidgetDTO>,
): CrmDashboardWidgetDTO {
  const now = new Date().toISOString()
  return {
    id: createId(),
    dashboardId: createId(),
    type: 'CHART',
    x: 0,
    y: 0,
    w: 4,
    h: 6,
    page: 0,
    config: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export async function seedCrmDashboardWidget(
  dashboardId: string,
  overrides?: Partial<
    Pick<CrmDashboardWidget, 'type' | 'x' | 'y' | 'w' | 'h' | 'page'>
  >,
) {
  return prisma.crmDashboardWidget.create({
    data: { dashboardId, type: 'CHART', config: {}, ...overrides },
  })
}
