import { describe, expect, it } from 'vitest'
import {
  isWebhookEventType,
  parseWebhookEventData,
  SUBSCRIBABLE_WEBHOOK_EVENT_TYPES,
  WEBHOOK_DATA_SCHEMAS,
  WEBHOOK_EVENT_EXAMPLES,
  WEBHOOK_EVENTS,
  type WebhookEventType,
  webhookEventDefinition,
  webhookEventMatches,
  webhookEventModuleKind,
} from '@/src/lib/webhooks/events'

describe('webhook event catalog', () => {
  it('should define one schema and one example per type, and nothing else', () => {
    const types = WEBHOOK_EVENTS.map((event) => event.type).sort()
    expect(Object.keys(WEBHOOK_DATA_SCHEMAS).sort()).toEqual(types)
    expect(Object.keys(WEBHOOK_EVENT_EXAMPLES).sort()).toEqual(types)
    expect(new Set(types).size).toBe(types.length)
  })

  it.each(WEBHOOK_EVENTS.map((event) => event.type))(
    'should parse the sample data of %s',
    (type) => {
      const parsed = parseWebhookEventData(type, WEBHOOK_EVENT_EXAMPLES[type])
      expect(parsed.success).toBe(true)
    },
  )

  it('should keep the contract types of ADR 0036', () => {
    for (const type of [
      'servicedesk.ticket.created',
      'servicedesk.ticket.updated',
      'crm.lead.created',
      'crm.opportunity.stage_changed',
      'crm.deal.won',
      'communication.message.received',
    ]) {
      expect(isWebhookEventType(type)).toBe(true)
    }
    expect(isWebhookEventType('crm.unknown')).toBe(false)
  })

  it('should refuse data that does not match the schema', () => {
    expect(
      parseWebhookEventData('crm.deal.won', { source: 'lead' }).success,
    ).toBe(false)
  })

  it('should drop unknown keys so internal fields never leak', () => {
    const parsed = parseWebhookEventData('steel.ping', {
      message: 'oi',
      secret: 'nope',
    })
    expect(parsed).toEqual({ success: true, data: { message: 'oi' } })
  })

  it('should leave steel.ping out of the subscribable types', () => {
    expect(SUBSCRIBABLE_WEBHOOK_EVENT_TYPES).not.toContain('steel.ping')
    expect(webhookEventDefinition('steel.ping').subscribable).toBe(false)
  })

  it('should match explicit subscriptions and the wildcard, never the ping', () => {
    const type: WebhookEventType = 'crm.lead.created'
    expect(webhookEventMatches(['crm.lead.created'], type)).toBe(true)
    expect(webhookEventMatches(['*'], type)).toBe(true)
    expect(webhookEventMatches(['crm.deal.won'], type)).toBe(false)
    expect(webhookEventMatches(['*'], 'steel.ping')).toBe(false)
  })

  it('should map modules to ModuleKind (agents and platform have none)', () => {
    expect(webhookEventModuleKind('SERVICE_DESK')).toBe('SERVICE_DESK')
    expect(webhookEventModuleKind('CRM')).toBe('CRM')
    expect(webhookEventModuleKind('COMMUNICATION')).toBe('COMMUNICATION')
    expect(webhookEventModuleKind('AGENTS')).toBeNull()
    expect(webhookEventModuleKind('PLATFORM')).toBeNull()
  })
})
