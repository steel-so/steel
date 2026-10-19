/**
 * DTOs of the workspace-level integrations (Ajustes > Integrações). The
 * token and the webhook secret **never** appear in a DTO — not even masked:
 * the page only knows whether a secret exists (`hasWebhookSecret`).
 */

export type WorkspaceIntegrationKindDTO = 'SLACK' | 'GITHUB' | 'GITLAB' | 'APOLLO'
export type WorkspaceIntegrationStatusDTO = 'ACTIVE' | 'ERROR' | 'DISCONNECTED'
export type IntegrationModuleDTO = 'SERVICE_DESK' | 'CRM' | 'COMMUNICATION'

export interface SlackNotificationRouteDTO {
  event: string
  /** `null` = the ticket team's channel (ServiceDesk events only). */
  channelId: string | null
  channelName: string | null
}

export interface WorkspaceSlackSettingsDTO {
  routes: SlackNotificationRouteDTO[]
  waitingMinutes: number
}

export interface WorkspaceIntegrationDTO {
  id: string
  kind: WorkspaceIntegrationKindDTO
  status: WorkspaceIntegrationStatusDTO
  statusError: string | null
  /** Slack team (`T…`), GitHub `owner/repo` or GitLab `group/project`. */
  externalId: string
  externalName: string | null
  /** GitLab instance; `null` for Slack and GitHub. */
  baseUrl: string | null
  hasWebhookSecret: boolean
  lastEventAt: string | null
  lastEventType: string | null
  lastCheckedAt: string | null
  /** Slack only: notification rules. */
  slack: WorkspaceSlackSettingsDTO | null
  createdAt: string
  updatedAt: string
}

export interface WorkspaceIntegrationProviderDTO {
  kind: WorkspaceIntegrationKindDTO
  /** `false` when the server lacks the app-level config (e.g. Slack app). */
  available: boolean
  /** pt-BR reason shown on the disabled card. */
  unavailableReason: string | null
  /** URL to register on the provider (Slack Request URL, repo webhook). */
  webhookUrl: string | null
  connection: WorkspaceIntegrationDTO | null
}

export interface WorkspaceIntegrationsOverviewDTO {
  providers: WorkspaceIntegrationProviderDTO[]
  /** Modules enabled in the workspace (filters the notification events). */
  enabledModules: IntegrationModuleDTO[]
}

export interface SlackChannelOptionDTO {
  id: string
  name: string
  isPrivate: boolean
}

export interface WorkspaceIntegrationTestDTO {
  ok: boolean
  /** pt-BR: what was checked, or why it failed. */
  message: string
  integration: WorkspaceIntegrationDTO
}
