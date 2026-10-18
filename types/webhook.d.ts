export type WebhookEventModuleDTO =
  | 'SERVICE_DESK'
  | 'CRM'
  | 'COMMUNICATION'
  | 'AGENTS'
  | 'PLATFORM'

/** One entry of the event catalog (`GET /api/v1/webhooks/events`). */
export interface WebhookEventTypeDTO {
  type: string
  module: WebhookEventModuleDTO
  /** pt-BR. */
  description: string
  /** `false` only for `steel.ping`. */
  subscribable: boolean
}

export interface WebhookEndpointDTO {
  id: string
  workspaceId: string
  url: string
  description: string | null
  /** Catalog types, or `['*']` for every event. */
  events: string[]
  active: boolean
  /** `whsec_…abcd`: the secret itself never comes back here. */
  secretHint: string
  disabledAt: string | null
  /** `auto` when Steel switched it off after 3 days failing. */
  disabledReason: string | null
  failingSince: string | null
  lastSuccessAt: string | null
  lastFailureAt: string | null
  createdById: string
  createdAt: string
  updatedAt: string
}

/** Create and rotate: the only responses that carry the secret. */
export interface WebhookEndpointWithSecretDTO {
  endpoint: WebhookEndpointDTO
  secret: string
}

export interface WebhookSecretDTO {
  secret: string
}

export type WebhookDeliveryStatusDTO =
  | 'PENDING'
  | 'SUCCEEDED'
  | 'RETRYING'
  | 'FAILED'
  | 'SKIPPED'

export interface WebhookDeliveryDTO {
  id: string
  endpointId: string
  eventId: string
  eventType: string
  status: WebhookDeliveryStatusDTO
  attempts: number
  /** HTTP status of the last attempt (`null`: no answer). */
  responseStatus: number | null
  /** First 1 KB of the last answer. */
  responseBody: string | null
  durationMs: number | null
  error: string | null
  /** Exact JSON body sent. */
  requestBody: string
  lastAttemptAt: string | null
  deliveredAt: string | null
  createdAt: string
}

export interface WebhookPageDTO<T> {
  items: T[]
  nextCursor: string | null
}

export interface WebhookTriggerResultDTO {
  event: { id: string; type: string }
  /** Endpoint deliveries queued (0 when only the listeners got it). */
  deliveries: number
}
