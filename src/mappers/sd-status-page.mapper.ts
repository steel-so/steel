import {
  sdStatusPageOverall,
  sdStatusPagePath,
} from '@/src/lib/servicedesk/major-incident'
import {
  toSdPublicComponentDTO,
  toSdPublicMaintenanceDTO,
} from '@/src/mappers/sd-status-maintenance.mapper'
import type { SdStatusComponentRow } from '@/src/repositories/sd-status-component.repository'
import type { SdStatusMaintenanceRow } from '@/src/repositories/sd-status-maintenance.repository'
import type {
  SdPublicIncidentRow,
  SdStatusPageRow,
  SdStatusSubscriberRow,
} from '@/src/repositories/sd-status-page.repository'
import type {
  SdPublicStatusIncidentDTO,
  SdPublicStatusPageDTO,
  SdStatusPageDTO,
  SdStatusSubscriberDTO,
} from '@/types/sd-status-page'

export function toSdStatusPageDTO(
  row: SdStatusPageRow,
  extra: {
    services: Map<string, string>
    customers: Map<string, string>
    subscribers: number
    active: number
  },
): SdStatusPageDTO {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    path: sdStatusPagePath(row.slug),
    description: row.description,
    customer: row.customerId
      ? {
          id: row.customerId,
          name: extra.customers.get(row.customerId) ?? 'Cliente removido',
        }
      : null,
    serviceIds: row.serviceIds,
    services: row.serviceIds
      .filter((id) => extra.services.has(id))
      .map((id) => ({ id, name: extra.services.get(id) as string })),
    published: row.published,
    allowSubscriptions: row.allowSubscriptions,
    subscriberCount: extra.subscribers,
    activeIncidentCount: extra.active,
    createdAt: row.createdAt.toISOString(),
  }
}

export function toSdStatusSubscriberDTO(
  row: SdStatusSubscriberRow,
): SdStatusSubscriberDTO {
  return {
    id: row.id,
    channel: row.channel,
    address: row.address,
    name: row.name,
    confirmed: row.confirmedAt !== null,
    createdAt: row.createdAt.toISOString(),
  }
}

function toPublicIncident(row: SdPublicIncidentRow): SdPublicStatusIncidentDTO {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    impact: row.impact,
    status: row.status,
    startedAt: row.declaredAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    updates: row.updates.map((u) => ({
      status: u.status,
      message: u.message,
      at: u.createdAt.toISOString(),
    })),
  }
}

export function toSdPublicStatusPageDTO(input: {
  page: SdStatusPageRow
  workspaceName: string
  services: string[]
  incidents: SdPublicIncidentRow[]
  components?: SdStatusComponentRow[]
  maintenances?: SdStatusMaintenanceRow[]
  now?: Date
}): SdPublicStatusPageDTO {
  const active = input.incidents.filter((i) => i.status !== 'RESOLVED')
  const recent = input.incidents.filter((i) => i.status === 'RESOLVED')
  const components = input.components ?? []
  const now = input.now ?? new Date()
  return {
    name: input.page.name,
    description: input.page.description,
    workspaceName: input.workspaceName,
    timeZone: input.page.timeZone,
    overall: sdStatusPageOverall(
      active.map((i) => i.impact),
      components.map((c) => c.state),
    ),
    services: input.services,
    components: components.map(toSdPublicComponentDTO),
    maintenances: (input.maintenances ?? []).map((m) =>
      toSdPublicMaintenanceDTO(m, now),
    ),
    allowSubscriptions: input.page.allowSubscriptions,
    active: active.map(toPublicIncident),
    recent: recent.map(toPublicIncident),
  }
}

/** `joao.silva@acme.com` -> `j***@acme.com`; numbers keep the last 4 digits. */
export function maskStatusAddress(
  channel: 'EMAIL' | 'WHATSAPP',
  address: string,
): string {
  if (channel === 'EMAIL') {
    const [local, domain] = address.split('@')
    return `${local.slice(0, 1)}***@${domain ?? ''}`
  }
  return `***${address.slice(-4)}`
}
