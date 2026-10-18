import { describe, expect, it } from 'vitest'
import { parseWebhookEventData } from '@/src/lib/webhooks/events'
import {
  communicationMessageReceivedData,
  crmLeadCreatedData,
  crmLeadDealData,
  crmOpportunityDealData,
  crmOpportunityStageChangedData,
  sdNotificationWebhookData,
  sdNotificationWebhookType,
  sdTicketSnapshot,
  sdTicketWebhookChange,
} from '@/src/lib/webhooks/payloads'

const at = new Date('2026-10-18T12:00:00.000Z')

const ticket = {
  id: 't1',
  number: 7,
  type: 'INCIDENT' as const,
  title: 'Sem rede',
  channel: 'PORTAL',
  phase: { id: 'p1', name: 'Novo', category: 'NEW', color: '#000' },
  priority: { id: 'pr1', name: 'Alta', level: 3 },
  departmentId: null,
  assigneeId: 'u1',
  requesterId: null,
  createdAt: at,
  updatedAt: at,
}

describe('webhook payload builders', () => {
  it('should snapshot a ticket with its code and only public fields', () => {
    const snapshot = sdTicketSnapshot(ticket, 'INC-000007')
    expect(snapshot).toEqual({
      id: 't1',
      number: 7,
      code: 'INC-000007',
      title: 'Sem rede',
      type: 'INCIDENT',
      channel: 'PORTAL',
      phase: { id: 'p1', name: 'Novo', category: 'NEW' },
      priority: { id: 'pr1', name: 'Alta' },
      departmentId: null,
      assigneeId: 'u1',
      requesterId: null,
      createdAt: at.toISOString(),
      updatedAt: at.toISOString(),
    })
    expect(
      parseWebhookEventData('servicedesk.ticket.created', {
        ticket: snapshot,
        actorId: null,
      }).success,
    ).toBe(true)
    expect(sdTicketSnapshot({ ...ticket, priority: null }, 'X').priority).toBe(
      null,
    )
  })

  it('should map the engine realtime types to created/updated', () => {
    expect(sdTicketWebhookChange('ticket.created')).toEqual({
      type: 'servicedesk.ticket.created',
    })
    expect(sdTicketWebhookChange('ticket.updated')).toEqual({
      type: 'servicedesk.ticket.updated',
      change: 'fields',
    })
    expect(sdTicketWebhookChange('ticket.assigned')).toMatchObject({
      change: 'assigned',
    })
    expect(sdTicketWebhookChange('ticket.phase_changed')).toMatchObject({
      change: 'phase',
    })
    expect(sdTicketWebhookChange('ticket.message')).toBeNull()
  })

  it('should expose only the curated ServiceDesk notification events', () => {
    expect(sdNotificationWebhookType('sla.breached')).toBe(
      'servicedesk.sla.breached',
    )
    expect(sdNotificationWebhookType('ticket.internal_note')).toBeNull()
    expect(sdNotificationWebhookType('kb.review_due')).toBeNull()
    const data = sdNotificationWebhookData({
      ticket: { id: 't1', number: 7, code: 'INC-000007', title: 'Sem rede' },
      title: 'SLA violado',
      body: 'Venceu',
    })
    expect(data).toEqual({
      ticket: { id: 't1', number: 7, code: 'INC-000007', title: 'Sem rede' },
      actorId: null,
      summary: { title: 'SLA violado', body: 'Venceu' },
    })
  })

  it('should build the CRM lead and deal data', () => {
    const lead = crmLeadCreatedData({
      id: 'l1',
      name: 'Ana',
      emails: ['ana@example.com'],
      phones: [],
      company: null,
      source: 'site',
      channel: 'FORM',
      score: 10,
      ownerId: null,
      createdAt: at.toISOString(),
    })
    expect(parseWebhookEventData('crm.lead.created', lead).success).toBe(true)

    expect(
      crmLeadDealData({
        lead: { id: 'l1', name: 'Ana', ownerId: 'u1', closedAmount: '1500.50' },
        actorId: 'u2',
      }),
    ).toEqual({
      source: 'lead',
      id: 'l1',
      name: 'Ana',
      amount: 1500.5,
      ownerId: 'u1',
      actorId: 'u2',
    })
    expect(
      crmLeadDealData({
        lead: { id: 'l1', name: 'Ana', ownerId: null, closedAmount: 'x' },
        actorId: null,
      }).amount,
    ).toBeNull()
    expect(
      crmLeadDealData({
        lead: { id: 'l1', name: 'Ana', ownerId: null },
        actorId: null,
      }).amount,
    ).toBeNull()
  })

  it('should build the opportunity stage change and deal data', () => {
    const opportunity = {
      id: 'o1',
      name: 'Renovação',
      amount: { toNumber: () => 900 },
      pipelineId: 'pp1',
      ownerId: null,
    }
    const data = crmOpportunityStageChangedData({
      opportunity,
      fromStage: null,
      toStage: { id: 's2', name: 'Ganho', category: 'WON' },
      actorId: 'u1',
    })
    expect(data.opportunity.amount).toBe(900)
    expect(data.fromStage).toBeNull()
    expect(
      parseWebhookEventData('crm.opportunity.stage_changed', data).success,
    ).toBe(true)
    expect(
      crmOpportunityStageChangedData({
        opportunity: { ...opportunity, amount: 10 },
        fromStage: { id: 's1', name: 'Proposta', category: 'OPEN' },
        toStage: { id: 's2', name: 'Ganho', category: 'WON' },
        actorId: null,
      }).fromStage,
    ).toEqual({ id: 's1', name: 'Proposta', category: 'OPEN' })
    expect(
      crmOpportunityDealData({ opportunity, actorId: 'u1' }),
    ).toMatchObject({ source: 'opportunity', amount: 900 })
  })

  it('should build the received WhatsApp message data', () => {
    const data = communicationMessageReceivedData({
      message: {
        id: 'm1',
        conversationId: 'c1',
        type: 'TEXT',
        text: 'oi',
        providerMessageId: 'wamid.1',
        createdAt: at,
      },
      contact: { id: 'ct1', waId: '5511', name: null },
      connectionId: 'cn1',
    })
    expect(data.message.receivedAt).toBe(at.toISOString())
    expect(
      parseWebhookEventData('communication.message.received', data).success,
    ).toBe(true)
  })
})
