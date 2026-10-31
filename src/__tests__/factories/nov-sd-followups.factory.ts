import { prisma } from '@/src/lib/prisma'
import type { SdStatusComponentRow } from '@/src/repositories/sd-status-component.repository'
import type { SdStatusMaintenanceRow } from '@/src/repositories/sd-status-maintenance.repository'

const fixed = () => new Date('2026-10-01T12:00:00.000Z')

export function createFakeSdStatusComponent(
  overrides?: Partial<SdStatusComponentRow>,
): SdStatusComponentRow {
  return {
    id: 'cmp1',
    workspaceId: 'ws1',
    pageId: 'p1',
    name: 'Telefonia',
    serviceId: null,
    state: 'OPERATIONAL',
    position: 0,
    stateChangedAt: fixed(),
    createdAt: fixed(),
    updatedAt: fixed(),
    ...overrides,
  }
}

export function createFakeSdStatusMaintenance(
  overrides?: Partial<SdStatusMaintenanceRow>,
): SdStatusMaintenanceRow {
  return {
    id: 'mw1',
    workspaceId: 'ws1',
    title: 'Troca do switch',
    description: 'Queda curta.',
    startsAt: new Date('2026-11-10T22:00:00.000Z'),
    endsAt: new Date('2026-11-11T02:00:00.000Z'),
    suppressMonitoring: false,
    configItemIds: [],
    notifySubscribers: true,
    announcedAt: null,
    canceledAt: null,
    canceledNoticeAt: null,
    notifyTotal: 0,
    notifySent: 0,
    notifyFailed: 0,
    createdById: 'u1',
    createdAt: fixed(),
    updatedAt: fixed(),
    pages: [
      {
        maintenanceId: 'mw1',
        pageId: 'p1',
        workspaceId: 'ws1',
        page: { id: 'p1', name: 'Acme', slug: 'acme-abc123' },
      },
    ],
    ...overrides,
  }
}

export async function seedSdStatusMaintenance(
  workspaceId: string,
  pageIds: string[],
  overrides: Partial<{
    title: string
    startsAt: Date
    endsAt: Date
    suppressMonitoring: boolean
    configItemIds: string[]
    notifySubscribers: boolean
    canceledAt: Date | null
    announcedAt: Date | null
  }> = {},
) {
  return prisma.sdStatusMaintenance.create({
    data: {
      workspaceId,
      title: overrides.title ?? 'Troca do switch',
      startsAt: overrides.startsAt ?? new Date(Date.now() + 3_600_000),
      endsAt: overrides.endsAt ?? new Date(Date.now() + 7_200_000),
      suppressMonitoring: overrides.suppressMonitoring ?? false,
      configItemIds: overrides.configItemIds ?? [],
      notifySubscribers: overrides.notifySubscribers ?? true,
      canceledAt: overrides.canceledAt ?? null,
      announcedAt: overrides.announcedAt ?? null,
      pages: { create: pageIds.map((pageId) => ({ pageId, workspaceId })) },
    },
  })
}
