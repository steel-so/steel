import {
  WEBHOOK_EVENT_MODULE_LABEL,
  WEBHOOK_EVENTS,
  type WebhookEventModule,
} from '@/src/lib/webhooks/events'
import type { WebhookDeliveryStatusDTO } from '@/types/webhook'

/** Pure helpers of the webhooks page (labels, grouping). */

export const DELIVERY_STATUS_LABEL: Record<WebhookDeliveryStatusDTO, string> = {
  PENDING: 'Na fila',
  SUCCEEDED: 'Entregue',
  RETRYING: 'Tentando de novo',
  FAILED: 'Falhou',
  SKIPPED: 'Não enviado',
}

export type DeliveryBadgeVariant =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline'

export const DELIVERY_STATUS_VARIANT: Record<
  WebhookDeliveryStatusDTO,
  DeliveryBadgeVariant
> = {
  PENDING: 'outline',
  SUCCEEDED: 'default',
  RETRYING: 'secondary',
  FAILED: 'destructive',
  SKIPPED: 'outline',
}

export interface WebhookEventGroup {
  module: WebhookEventModule
  label: string
  events: { type: string; description: string }[]
}

/** Subscribable events grouped by module, in catalog order. */
export function webhookEventGroups(): WebhookEventGroup[] {
  const groups = new Map<WebhookEventModule, WebhookEventGroup>()
  for (const event of WEBHOOK_EVENTS) {
    if (!event.subscribable) continue
    const group = groups.get(event.module) ?? {
      module: event.module,
      label: WEBHOOK_EVENT_MODULE_LABEL[event.module],
      events: [],
    }
    group.events.push({ type: event.type, description: event.description })
    groups.set(event.module, group)
  }
  return [...groups.values()]
}

/** "Todos os eventos" or "3 eventos". */
export function webhookEventsSummary(events: string[]): string {
  if (events.includes('*')) return 'Todos os eventos'
  return events.length === 1 ? '1 evento' : `${events.length} eventos`
}

/** `https://erp.example.com/hook` → `erp.example.com`. */
export function webhookHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Pretty JSON when the body parses, the raw text otherwise. */
export function prettyBody(body: string | null): string {
  if (!body) return ''
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return body
  }
}
