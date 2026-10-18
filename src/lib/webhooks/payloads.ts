import type { WebhookEventData } from './events'

/**
 * Builders of the webhook `data` from the domain rows the modules already
 * hold (pure, no I/O). Keeping the mapping here — not in each service —
 * keeps the public shapes of `events.ts` in one reviewed place.
 */

export interface SdTicketSnapshotSource {
  id: string
  number: number
  type: 'INCIDENT' | 'SERVICE_REQUEST' | 'CHANGE' | 'PROBLEM'
  title: string
  channel: string
  phase: { id: string; name: string; category: string }
  priority: { id: string; name: string } | null
  departmentId: string | null
  assigneeId: string | null
  requesterId: string | null
  createdAt: Date
  updatedAt: Date
}

export function sdTicketSnapshot(
  ticket: SdTicketSnapshotSource,
  code: string,
): WebhookEventData<'servicedesk.ticket.created'>['ticket'] {
  return {
    id: ticket.id,
    number: ticket.number,
    code,
    title: ticket.title,
    type: ticket.type,
    channel: ticket.channel,
    phase: {
      id: ticket.phase.id,
      name: ticket.phase.name,
      category: ticket.phase.category,
    },
    priority: ticket.priority
      ? { id: ticket.priority.id, name: ticket.priority.name }
      : null,
    departmentId: ticket.departmentId,
    assigneeId: ticket.assigneeId,
    requesterId: ticket.requesterId,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
  }
}

/** Realtime type of the ticket engine → webhook type + `change`. */
export function sdTicketWebhookChange(realtimeType: string):
  | { type: 'servicedesk.ticket.created' }
  | {
      type: 'servicedesk.ticket.updated'
      change: 'fields' | 'assigned' | 'phase'
    }
  | null {
  switch (realtimeType) {
    case 'ticket.created':
      return { type: 'servicedesk.ticket.created' }
    case 'ticket.updated':
      return { type: 'servicedesk.ticket.updated', change: 'fields' }
    case 'ticket.assigned':
      return { type: 'servicedesk.ticket.updated', change: 'assigned' }
    case 'ticket.phase_changed':
      return { type: 'servicedesk.ticket.updated', change: 'phase' }
    default:
      return null
  }
}

/**
 * ServiceDesk notification events (`notifySdEvent`, the same place the
 * Slack rules fire) that are also webhooks. Others (internal notes,
 * mentions, KB reviews, digests…) stay internal.
 */
const SD_NOTIFICATION_WEBHOOKS = {
  'ticket.assigned': 'servicedesk.ticket.assigned',
  'ticket.message': 'servicedesk.ticket.message',
  'ticket.resolved': 'servicedesk.ticket.resolved',
  'ticket.reopened': 'servicedesk.ticket.reopened',
  'ticket.escalated': 'servicedesk.ticket.escalated',
  'ticket.csat': 'servicedesk.ticket.csat',
  'sla.at_risk': 'servicedesk.sla.at_risk',
  'sla.breached': 'servicedesk.sla.breached',
  'approval.requested': 'servicedesk.approval.requested',
  'approval.responded': 'servicedesk.approval.responded',
} as const

export type SdNotificationWebhookType =
  (typeof SD_NOTIFICATION_WEBHOOKS)[keyof typeof SD_NOTIFICATION_WEBHOOKS]

export function sdNotificationWebhookType(
  sdEvent: string,
): SdNotificationWebhookType | null {
  return (
    (SD_NOTIFICATION_WEBHOOKS as Record<string, SdNotificationWebhookType>)[
      sdEvent
    ] ?? null
  )
}

export function sdNotificationWebhookData(input: {
  ticket: { id: string; number: number; code: string; title: string }
  actorId?: string | null
  title: string
  body: string
}): WebhookEventData<SdNotificationWebhookType> {
  return {
    ticket: {
      id: input.ticket.id,
      number: input.ticket.number,
      code: input.ticket.code,
      title: input.ticket.title,
    },
    actorId: input.actorId ?? null,
    summary: { title: input.title, body: input.body },
  }
}

export function crmLeadCreatedData(lead: {
  id: string
  name: string
  emails: string[]
  phones: string[]
  company: string | null
  source: string | null
  channel: string | null
  score: number
  ownerId: string | null
  createdAt: string
}): WebhookEventData<'crm.lead.created'> {
  return {
    lead: {
      id: lead.id,
      name: lead.name,
      emails: lead.emails,
      phones: lead.phones,
      company: lead.company,
      source: lead.source,
      channel: lead.channel,
      score: lead.score,
      ownerId: lead.ownerId,
      createdAt: lead.createdAt,
    },
  }
}

type DecimalLike = { toNumber(): number } | number | string | null | undefined

function amountOf(value: DecimalLike): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return value.toNumber()
}

export function crmLeadDealData(input: {
  lead: {
    id: string
    name: string
    ownerId: string | null
    closedAmount?: DecimalLike
  }
  actorId: string | null
}): WebhookEventData<'crm.deal.won'> {
  return {
    source: 'lead',
    id: input.lead.id,
    name: input.lead.name,
    amount: amountOf(input.lead.closedAmount),
    ownerId: input.lead.ownerId,
    actorId: input.actorId,
  }
}

export interface CrmStageRef {
  id: string
  name: string
  category: 'OPEN' | 'WON' | 'LOST'
}

export function crmOpportunityStageChangedData(input: {
  opportunity: {
    id: string
    name: string
    amount: DecimalLike
    pipelineId: string
    ownerId: string | null
  }
  fromStage: CrmStageRef | null
  toStage: CrmStageRef
  actorId: string | null
}): WebhookEventData<'crm.opportunity.stage_changed'> {
  return {
    opportunity: {
      id: input.opportunity.id,
      name: input.opportunity.name,
      amount: amountOf(input.opportunity.amount),
      pipelineId: input.opportunity.pipelineId,
      ownerId: input.opportunity.ownerId,
    },
    fromStage: input.fromStage
      ? {
          id: input.fromStage.id,
          name: input.fromStage.name,
          category: input.fromStage.category,
        }
      : null,
    toStage: {
      id: input.toStage.id,
      name: input.toStage.name,
      category: input.toStage.category,
    },
    actorId: input.actorId,
  }
}

export function crmOpportunityDealData(input: {
  opportunity: {
    id: string
    name: string
    amount: DecimalLike
    ownerId: string | null
  }
  actorId: string | null
}): WebhookEventData<'crm.deal.won'> {
  return {
    source: 'opportunity',
    id: input.opportunity.id,
    name: input.opportunity.name,
    amount: amountOf(input.opportunity.amount),
    ownerId: input.opportunity.ownerId,
    actorId: input.actorId,
  }
}

export function communicationMessageReceivedData(input: {
  message: {
    id: string
    conversationId: string
    type: string
    text: string | null
    providerMessageId: string | null
    createdAt: Date
  }
  contact: { id: string; waId: string; name: string | null }
  connectionId: string
}): WebhookEventData<'communication.message.received'> {
  return {
    message: {
      id: input.message.id,
      conversationId: input.message.conversationId,
      type: input.message.type,
      text: input.message.text,
      providerMessageId: input.message.providerMessageId,
      receivedAt: input.message.createdAt.toISOString(),
    },
    contact: {
      id: input.contact.id,
      waId: input.contact.waId,
      name: input.contact.name,
    },
    connectionId: input.connectionId,
  }
}
