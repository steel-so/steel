import type { SdMonitorSource } from '@prisma/client'
import { sdMonitorSeverityMap } from '@/src/lib/servicedesk/monitoring'
import type { SdMonitorAlertWithRelations } from '@/src/repositories/sd-monitor-alert.repository'
import type {
  SdMonitorAlertDTO,
  SdMonitorSourceDTO,
  SdMonitorSourceWithTokenDTO,
} from '@/types/sd-monitor'

/** Caminho público do webhook da origem (sem o domínio). */
export function sdMonitorWebhookPath(token: string): string {
  return `/api/servicedesk/monitoring/${token}`
}

export function toSdMonitorSourceDTO(
  source: SdMonitorSource,
): SdMonitorSourceDTO {
  return {
    id: source.id,
    name: source.name,
    kind: source.kind,
    active: source.active,
    ticketType: source.ticketType,
    departmentId: source.departmentId,
    categoryId: source.categoryId,
    customerId: source.customerId,
    severityMap: sdMonitorSeverityMap(source.severityMap),
    autoResolve: source.autoResolve,
    flappingWindowMinutes: source.flappingWindowMinutes,
    correlationMode: source.correlationMode,
    correlationWindowMinutes: source.correlationWindowMinutes,
    lastEventAt: source.lastEventAt?.toISOString() ?? null,
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
  }
}

/** Só na criação e na regeração: o token em claro não volta mais depois. */
export function toSdMonitorSourceWithTokenDTO(
  source: SdMonitorSource,
  token: string,
): SdMonitorSourceWithTokenDTO {
  return {
    ...toSdMonitorSourceDTO(source),
    token,
    webhookPath: sdMonitorWebhookPath(token),
  }
}

export function toSdMonitorAlertDTO(
  alert: SdMonitorAlertWithRelations,
): SdMonitorAlertDTO {
  return {
    id: alert.id,
    sourceId: alert.sourceId,
    sourceName: alert.source.name,
    sourceKind: alert.source.kind,
    status: alert.status,
    externalId: alert.externalId,
    severity: alert.severity,
    host: alert.host,
    subject: alert.subject,
    body: alert.body,
    configItem: alert.configItem
      ? { id: alert.configItem.id, name: alert.configItem.name }
      : null,
    ticket: alert.ticket
      ? {
          id: alert.ticket.id,
          number: alert.ticket.number,
          title: alert.ticket.title,
          phase: alert.ticket.phase.name,
        }
      : null,
    correlated: alert.correlated,
    occurrences: alert.occurrences,
    lastSeenAt: alert.lastSeenAt.toISOString(),
    startedAt: alert.startedAt.toISOString(),
    resolvedAt: alert.resolvedAt?.toISOString() ?? null,
    createdAt: alert.createdAt.toISOString(),
  }
}
