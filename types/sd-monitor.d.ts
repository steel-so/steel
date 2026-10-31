/**
 * DTOs do monitoramento do ServiceDesk: origens (Zabbix / webhook genérico)
 * e os alertas que elas mandam. O token da origem **nunca** entra no DTO de
 * leitura — só aparece uma vez, na criação e na regeração.
 */

export type SdMonitorKindDTO = 'ZABBIX' | 'WEBHOOK' | 'GRAFANA' | 'PRTG'
export type SdMonitorCorrelationModeDTO = 'OFF' | 'HOST'
export type SdMonitorAlertStatusDTO = 'OPEN' | 'RESOLVED' | 'IGNORED'

export interface SdMonitorSeverityMapEntry {
  from: string
  priorityId: string
}

export interface SdMonitorSourceDTO {
  id: string
  name: string
  kind: SdMonitorKindDTO
  active: boolean
  ticketType: 'INCIDENT' | 'SERVICE_REQUEST' | 'CHANGE' | 'PROBLEM'
  departmentId: string | null
  categoryId: string | null
  customerId: string | null
  severityMap: SdMonitorSeverityMapEntry[]
  autoResolve: boolean
  flappingWindowMinutes: number
  /** `HOST`: alerta da mesma máquina entra no chamado aberto. */
  correlationMode: SdMonitorCorrelationModeDTO
  correlationWindowMinutes: number
  /** Correlated alert more severe than the ticket raises its priority. */
  raisePriorityOnCorrelation: boolean
  /** Último alerta recebido (`null` = nunca recebeu nada). */
  lastEventAt: string | null
  /** Caminho público do webhook, sem o domínio (só na criação/regeração). */
  webhookPath?: string
  createdAt: string
  updatedAt: string
}

/** Resposta da criação/regeração: o token em claro aparece só aqui. */
export interface SdMonitorSourceWithTokenDTO extends SdMonitorSourceDTO {
  token: string
  webhookPath: string
}

export interface SdMonitorAlertDTO {
  id: string
  sourceId: string
  sourceName: string
  sourceKind: SdMonitorKindDTO
  status: SdMonitorAlertStatusDTO
  externalId: string
  severity: string | null
  host: string | null
  subject: string
  body: string | null
  configItem: { id: string; name: string } | null
  ticket: {
    id: string
    number: number
    title: string
    phase: string
  } | null
  /** Entrou num chamado aberto por outro alerta (correlação). */
  correlated: boolean
  /** Quantas vezes o mesmo alerta chegou (deduplicação). */
  occurrences: number
  /** Arrived in a maintenance window: no ticket was opened for it. */
  suppressed: boolean
  lastSeenAt: string
  startedAt: string
  resolvedAt: string | null
  createdAt: string
}

/** O que a entrada pública devolve para a ferramenta de monitoramento. */
export interface SdMonitorIngestDTO {
  alertId: string
  status: SdMonitorAlertStatusDTO
  /** O que o alerta provocou no ServiceDesk. */
  outcome:
    | 'ticket_created'
    | 'ticket_reopened'
    | 'alert_updated'
    | 'alert_correlated'
    | 'alert_suppressed'
    | 'ticket_resolved'
    | 'alert_resolved'
  ticket: { id: string; number: number; code: string } | null
}

/** Resposta do webhook com vários alertas (Grafana e Alertmanager agrupam). */
export interface SdMonitorIngestBatchDTO extends SdMonitorIngestDTO {
  alerts: SdMonitorIngestDTO[]
}
