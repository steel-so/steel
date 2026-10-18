import { z } from 'zod'
import {
  isWebhookEventType,
  SUBSCRIBABLE_WEBHOOK_EVENT_TYPES,
  WEBHOOK_ALL_EVENTS,
  WEBHOOK_EVENTS,
  type WebhookEventType,
} from '@/src/lib/webhooks/events'

/**
 * Outbound webhooks (ADR 0036): endpoints, the delivery log query, the test
 * trigger and the listen filter. The same schemas serve the app routes
 * (`/api/workspaces/{id}/webhooks/**`) and the API v1 (`/api/v1/webhooks/**`).
 */

/** Per-workspace cap of endpoints (not deleted). */
export const WEBHOOK_ENDPOINT_LIMIT = 20
export const WEBHOOK_URL_MAX = 2048
export const WEBHOOK_DESCRIPTION_MAX = 200
export const WEBHOOK_DELIVERY_PAGE_DEFAULT = 25
export const WEBHOOK_DELIVERY_PAGE_MAX = 100

const SUBSCRIPTIONS = [WEBHOOK_ALL_EVENTS, ...SUBSCRIBABLE_WEBHOOK_EVENT_TYPES]

export const WebhookSubscriptionSchema = z.enum(
  SUBSCRIPTIONS as [string, ...string[]],
  { error: 'Evento fora do catálogo de webhooks' },
)

const UrlSchema = z
  .string()
  .trim()
  .min(1, 'Informe a URL')
  .max(WEBHOOK_URL_MAX, 'URL longa demais')
  .url('URL inválida')
  .refine((value) => value.toLowerCase().startsWith('https://'), {
    message: 'A URL precisa começar com https://',
  })

const EventsSchema = z
  .array(WebhookSubscriptionSchema)
  .min(1, 'Escolha ao menos um evento')
  .max(SUBSCRIPTIONS.length)
  .transform((events) =>
    events.includes(WEBHOOK_ALL_EVENTS)
      ? [WEBHOOK_ALL_EVENTS]
      : Array.from(new Set(events)),
  )

const DescriptionSchema = z
  .string()
  .trim()
  .max(WEBHOOK_DESCRIPTION_MAX, 'Descrição longa demais')

export const CreateWebhookEndpointSchema = z.object({
  url: UrlSchema,
  description: DescriptionSchema.optional(),
  events: EventsSchema,
  active: z.boolean().optional(),
})
export type CreateWebhookEndpointDTO = z.infer<
  typeof CreateWebhookEndpointSchema
>

export const UpdateWebhookEndpointSchema = z
  .object({
    url: UrlSchema,
    description: DescriptionSchema.nullable(),
    events: EventsSchema,
    active: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Nada para alterar',
  })
export type UpdateWebhookEndpointDTO = z.infer<
  typeof UpdateWebhookEndpointSchema
>

export const WEBHOOK_DELIVERY_STATUSES = [
  'PENDING',
  'SUCCEEDED',
  'RETRYING',
  'FAILED',
  'SKIPPED',
] as const

export const ListWebhookDeliveriesQuerySchema = z.object({
  endpointId: z.string().min(1).optional(),
  status: z.enum(WEBHOOK_DELIVERY_STATUSES).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(WEBHOOK_DELIVERY_PAGE_MAX)
    .default(WEBHOOK_DELIVERY_PAGE_DEFAULT),
  cursor: z.string().min(1).optional(),
})
export type ListWebhookDeliveriesQuery = z.infer<
  typeof ListWebhookDeliveriesQuerySchema
>

const EventTypeSchema = z
  .string()
  .refine(isWebhookEventType, {
    message: 'Evento fora do catálogo de webhooks',
  })
  .transform((value) => value as WebhookEventType)

/**
 * `steel trigger <type>`: a test event with the catalog's sample data. Goes
 * to the listeners and, with `endpointId`, to that endpoint too.
 */
export const TriggerWebhookEventSchema = z.object({
  type: EventTypeSchema,
  endpointId: z.string().min(1).optional(),
})
export type TriggerWebhookEventDTO = z.infer<typeof TriggerWebhookEventSchema>

/** `?events=a,b` of the listen stream; empty = every event. */
export const ListenWebhookQuerySchema = z.object({
  events: z
    .string()
    .optional()
    .transform((raw) =>
      (raw ?? '')
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part !== '' && part !== WEBHOOK_ALL_EVENTS),
    )
    .pipe(z.array(EventTypeSchema)),
})
export type ListenWebhookQuery = z.infer<typeof ListenWebhookQuerySchema>

/** Every type, for the OpenAPI enum. */
export const WEBHOOK_EVENT_TYPE_VALUES = WEBHOOK_EVENTS.map(
  (event) => event.type,
)
