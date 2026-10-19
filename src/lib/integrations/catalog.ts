import {
  SD_NOTIFICATION_EVENTS,
  SD_NOTIFICATION_GROUPS,
} from '@/src/config/servicedesk-notifications'

/**
 * Catalog of the workspace-level integrations (Ajustes > Integrações): the
 * providers and the Slack notification events every module can route to a
 * channel. Pure data — no I/O — so the page, the services and the tests share
 * one source of truth.
 */

export const WORKSPACE_INTEGRATION_KINDS = [
  'SLACK',
  'GITHUB',
  'GITLAB',
  'APOLLO',
] as const
export type WorkspaceIntegrationKindValue =
  (typeof WORKSPACE_INTEGRATION_KINDS)[number]

/** Repository providers (link tickets to issues/PRs/MRs). */
export const REPO_INTEGRATION_KINDS = ['GITHUB', 'GITLAB'] as const
export type RepoIntegrationKind = (typeof REPO_INTEGRATION_KINDS)[number]

export function isRepoIntegrationKind(
  kind: string,
): kind is RepoIntegrationKind {
  return kind === 'GITHUB' || kind === 'GITLAB'
}

export const INTEGRATION_PROVIDER_LABEL: Record<
  WorkspaceIntegrationKindValue,
  string
> = {
  SLACK: 'Slack',
  GITHUB: 'GitHub',
  GITLAB: 'GitLab',
  APOLLO: 'Apollo.io',
}

/** Module a notification event belongs to (Steel Agents is not a module). */
export type IntegrationEventModule =
  | 'SERVICE_DESK'
  | 'CRM'
  | 'COMMUNICATION'
  | 'AGENTS'

export const INTEGRATION_EVENT_MODULE_LABEL: Record<
  IntegrationEventModule,
  string
> = {
  SERVICE_DESK: 'ServiceDesk',
  CRM: 'CRM',
  COMMUNICATION: 'Comunicação',
  AGENTS: 'Steel Agents',
}

export interface IntegrationNotificationEvent {
  /** `servicedesk.sla.breached`, `crm.deal.won`… */
  key: string
  module: IntegrationEventModule
  /** pt-BR. */
  label: string
  /** Group inside the module (the ServiceDesk catalog has several). */
  group: string
  /**
   * ServiceDesk events may be routed to "the team's channel only" (a
   * channel-less rule): the ServiceDesk settings map a channel per team.
   */
  allowsTeamChannel: boolean
}

/** Prefix of the ServiceDesk events (`servicedesk.<SD catalog key>`). */
export const SD_SLACK_EVENT_PREFIX = 'servicedesk.'

/** Derived event: a new ticket born with the workspace's top priority. */
export const SD_URGENT_TICKET_EVENT = 'servicedesk.ticket.urgent'

export function sdSlackEventKey(sdEvent: string): string {
  return `${SD_SLACK_EVENT_PREFIX}${sdEvent}`
}

/** SD event key → its group, for the groups offered to Slack (no digests). */
const SD_GROUP_OF = new Map(
  SD_NOTIFICATION_GROUPS.filter((group) => group.label !== 'Resumos').flatMap(
    (group) => group.events.map((event) => [event, group.label] as const),
  ),
)

/** ServiceDesk events offered to Slack: every ticket event, no digests. */
const SD_EVENTS: IntegrationNotificationEvent[] = [
  {
    key: SD_URGENT_TICKET_EVENT,
    module: 'SERVICE_DESK',
    label: 'Chamado urgente aberto (prioridade mais alta)',
    group: 'Chamados',
    allowsTeamChannel: true,
  },
  ...SD_NOTIFICATION_EVENTS.filter((event) => SD_GROUP_OF.has(event.key)).map(
    (event) => ({
      key: sdSlackEventKey(event.key),
      module: 'SERVICE_DESK' as const,
      label: event.label,
      group: SD_GROUP_OF.get(event.key) as string,
      allowsTeamChannel: true,
    }),
  ),
]

const OTHER_EVENTS: IntegrationNotificationEvent[] = [
  {
    key: 'crm.lead.created',
    module: 'CRM',
    label: 'Novo lead',
    group: 'Leads',
    allowsTeamChannel: false,
  },
  {
    key: 'crm.deal.won',
    module: 'CRM',
    label: 'Negócio ganho',
    group: 'Negócios',
    allowsTeamChannel: false,
  },
  {
    key: 'crm.deal.lost',
    module: 'CRM',
    label: 'Negócio perdido',
    group: 'Negócios',
    allowsTeamChannel: false,
  },
  {
    key: 'communication.conversation.waiting',
    module: 'COMMUNICATION',
    label: 'Conversa aguardando resposta há muito tempo',
    group: 'Conversas',
    allowsTeamChannel: false,
  },
  {
    key: 'agents.approval.pending',
    module: 'AGENTS',
    label: 'Aprovação pendente de um agente',
    group: 'Aprovações',
    allowsTeamChannel: false,
  },
]

export const INTEGRATION_NOTIFICATION_EVENTS: IntegrationNotificationEvent[] = [
  ...SD_EVENTS,
  ...OTHER_EVENTS,
]

const BY_KEY = new Map(INTEGRATION_NOTIFICATION_EVENTS.map((e) => [e.key, e]))

export function integrationNotificationEvent(
  key: string,
): IntegrationNotificationEvent | null {
  return BY_KEY.get(key) ?? null
}

/** Minutes a conversation may wait before the Slack alert (default). */
export const DEFAULT_WAITING_MINUTES = 15
export const MIN_WAITING_MINUTES = 5
export const MAX_WAITING_MINUTES = 24 * 60
