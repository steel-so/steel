/**
 * DTOs of the ServiceDesk side of the integrations. The connections are
 * workspace-level (Ajustes > Integrações, ADR 0024); here the ServiceDesk
 * sees the connection state and edits only its own module settings. Token
 * and webhook secret **never** appear in a DTO.
 */

export type SdIntegrationKindDTO = 'SLACK' | 'GITHUB' | 'GITLAB' | 'APOLLO'
export type SdIntegrationStatusDTO = 'ACTIVE' | 'ERROR' | 'DISCONNECTED'
export type SdIntegrationLinkKindDTO =
  | 'SLACK_THREAD'
  | 'GITHUB_ISSUE'
  | 'GITHUB_PULL_REQUEST'
  | 'GITLAB_ISSUE'
  | 'GITLAB_MERGE_REQUEST'
export type SdRepoProviderDTO = 'GITHUB' | 'GITLAB'

export interface SdSlackChannelMapDTO {
  departmentId: string | null
  channelId: string
  channelName: string | null
}

/** ServiceDesk settings of the Slack connection. */
export interface SdSlackConfigDTO {
  /** Channel per team (replaces the rule channel for that team's tickets). */
  channels: SdSlackChannelMapDTO[]
  allowTicketFromMessage: boolean
  mirrorThreadReplies: boolean
  ticketType: 'INCIDENT' | 'SERVICE_REQUEST' | 'CHANGE' | 'PROBLEM'
  departmentId: string | null
}

/** ServiceDesk settings of a GitHub/GitLab connection. */
export interface SdRepoConfigDTO {
  suggestPhaseOnClose: boolean
  allowIssueFromTicket: boolean
}

export interface SdIntegrationDTO {
  id: string
  kind: SdIntegrationKindDTO
  status: SdIntegrationStatusDTO
  statusError: string | null
  /** Slack team (`T…`), GitHub `owner/repo` or GitLab `group/project`. */
  externalId: string
  externalName: string | null
  /** GitLab instance; `null` otherwise. */
  baseUrl: string | null
  hasWebhookSecret: boolean
  lastEventAt: string | null
  slack: SdSlackConfigDTO | null
  repo: SdRepoConfigDTO | null
  createdAt: string
  updatedAt: string
}

/** Integrations tab of the ServiceDesk settings. */
export interface SdIntegrationsOverviewDTO {
  /** The Slack app has credentials on the server. */
  slackConfigured: boolean
  /** Where the connection is managed (`/{slug}/settings/integrations`). */
  manageHref: string | null
  slack: SdIntegrationDTO | null
  github: SdIntegrationDTO | null
  gitlab: SdIntegrationDTO | null
}

export interface SdIntegrationLinkDTO {
  id: string
  integrationId: string
  kind: SdIntegrationLinkKindDTO
  ticketId: string
  /** `canal:ts` (Slack), `owner/repo#n` (GitHub), `group/project#n|!n` (GitLab). */
  externalKey: string
  externalUrl: string | null
  /** `open`, `closed`, `merged` — `null` for a Slack thread. */
  externalState: string | null
  /** pt-BR label of the state (`Aberta`, `Fechada`, `Mesclada`). */
  externalStateLabel: string | null
  title: string | null
  createdAt: string
  updatedAt: string
}

/** Repository provider connected to the workspace, offered on the ticket. */
export interface SdRepoProviderOptionDTO {
  provider: SdRepoProviderDTO
  /** `owner/repo` or `group/project`. */
  project: string
  allowIssueFromTicket: boolean
}

/** Slack channel offered in the team-channel selector. */
export interface SdSlackChannelOptionDTO {
  id: string
  name: string
  isPrivate: boolean
}
