import { createId } from '@paralleldrive/cuid2'
import type {
  WebhookDelivery,
  WebhookDeliveryStatus,
  WebhookEndpoint,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type { WebhookDeliveryWithEndpoint } from '@/src/repositories/webhook-delivery.repository'

/** Outbound webhooks (ADR 0036): fake rows (unit) and seeds (integration). */

export function createFakeWebhookEndpoint(
  overrides?: Partial<WebhookEndpoint>,
): WebhookEndpoint {
  const now = new Date('2026-10-18T12:00:00.000Z')
  return {
    id: createId(),
    workspaceId: createId(),
    url: 'https://hooks.example.com/steel',
    description: null,
    events: ['crm.lead.created'],
    encryptedSecret: 'encrypted-secret',
    secretHint: 'a1b2',
    active: true,
    disabledAt: null,
    disabledReason: null,
    failingSince: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    createdById: createId(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  }
}

export function createFakeWebhookDelivery(
  overrides?: Partial<WebhookDelivery>,
): WebhookDelivery {
  const now = new Date('2026-10-18T12:00:00.000Z')
  const eventId = overrides?.eventId ?? `evt_${createId()}`
  return {
    id: createId(),
    workspaceId: createId(),
    endpointId: createId(),
    eventId,
    eventType: 'crm.lead.created',
    body: JSON.stringify({ id: eventId, type: 'crm.lead.created' }),
    status: 'PENDING',
    attempts: 0,
    responseStatus: null,
    responseBody: null,
    durationMs: null,
    error: null,
    lastAttemptAt: null,
    deliveredAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function createFakeWebhookDeliveryWithEndpoint(
  delivery?: Partial<WebhookDelivery>,
  endpoint?: Partial<WebhookEndpoint>,
): WebhookDeliveryWithEndpoint {
  const row = createFakeWebhookDelivery(delivery)
  return {
    ...row,
    endpoint: createFakeWebhookEndpoint({
      id: row.endpointId,
      workspaceId: row.workspaceId,
      ...endpoint,
    }),
  }
}

export async function seedWebhookEndpoint(data: {
  workspaceId: string
  createdById: string
  url?: string
  events?: string[]
  active?: boolean
  deletedAt?: Date | null
  failingSince?: Date | null
  createdAt?: Date
}) {
  return prisma.webhookEndpoint.create({
    data: {
      workspaceId: data.workspaceId,
      createdById: data.createdById,
      url: data.url ?? 'https://hooks.example.com/steel',
      events: data.events ?? ['crm.lead.created'],
      encryptedSecret: 'encrypted-secret',
      secretHint: 'a1b2',
      active: data.active ?? true,
      deletedAt: data.deletedAt ?? null,
      failingSince: data.failingSince ?? null,
      ...(data.createdAt ? { createdAt: data.createdAt } : {}),
    },
  })
}

export async function seedWebhookDelivery(data: {
  workspaceId: string
  endpointId: string
  eventType?: string
  status?: WebhookDeliveryStatus
  createdAt?: Date
}) {
  const eventId = `evt_${createId()}`
  return prisma.webhookDelivery.create({
    data: {
      workspaceId: data.workspaceId,
      endpointId: data.endpointId,
      eventId,
      eventType: data.eventType ?? 'crm.lead.created',
      body: JSON.stringify({ id: eventId }),
      status: data.status ?? 'PENDING',
      ...(data.createdAt ? { createdAt: data.createdAt } : {}),
    },
  })
}
