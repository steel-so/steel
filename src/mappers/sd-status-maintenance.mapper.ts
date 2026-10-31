import { sdMaintenancePhase } from '@/src/lib/servicedesk/status-maintenance'
import type { SdStatusComponentRow } from '@/src/repositories/sd-status-component.repository'
import type { SdStatusMaintenanceRow } from '@/src/repositories/sd-status-maintenance.repository'
import type {
  SdPublicMaintenanceDTO,
  SdPublicStatusComponentDTO,
  SdStatusComponentDTO,
  SdStatusMaintenanceDTO,
} from '@/types/sd-status-maintenance'

export function toSdStatusComponentDTO(
  row: SdStatusComponentRow,
): SdStatusComponentDTO {
  return {
    id: row.id,
    pageId: row.pageId,
    name: row.name,
    serviceId: row.serviceId,
    state: row.state,
    position: row.position,
    stateChangedAt: row.stateChangedAt.toISOString(),
  }
}

export function toSdPublicComponentDTO(
  row: SdStatusComponentRow,
): SdPublicStatusComponentDTO {
  return { name: row.name, state: row.state }
}

export function toSdStatusMaintenanceDTO(
  row: SdStatusMaintenanceRow,
  configItemNames: Map<string, string>,
  now: Date,
): SdStatusMaintenanceDTO {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    phase: sdMaintenancePhase(row, now),
    suppressMonitoring: row.suppressMonitoring,
    configItems: row.configItemIds.map((id) => ({
      id,
      name: configItemNames.get(id) ?? 'Item removido',
    })),
    pages: row.pages.map((link) => ({
      id: link.page.id,
      name: link.page.name,
      slug: link.page.slug,
    })),
    notifySubscribers: row.notifySubscribers,
    announcedAt: row.announcedAt?.toISOString() ?? null,
    canceledAt: row.canceledAt?.toISOString() ?? null,
    notify: {
      done: row.announcedAt !== null,
      total: row.notifyTotal,
      sent: row.notifySent,
      failed: row.notifyFailed,
    },
    createdAt: row.createdAt.toISOString(),
  }
}

export function toSdPublicMaintenanceDTO(
  row: SdStatusMaintenanceRow,
  now: Date,
): SdPublicMaintenanceDTO {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    inProgress: row.startsAt.getTime() <= now.getTime(),
  }
}
