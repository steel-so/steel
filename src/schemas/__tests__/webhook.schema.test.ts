import { describe, expect, it } from 'vitest'
import {
  CreateWebhookEndpointSchema,
  ListenWebhookQuerySchema,
  ListWebhookDeliveriesQuerySchema,
  TriggerWebhookEventSchema,
  UpdateWebhookEndpointSchema,
  WEBHOOK_EVENT_TYPE_VALUES,
} from '@/src/schemas/webhook.schema'

describe('CreateWebhookEndpointSchema', () => {
  it('should accept an HTTPS URL with catalog events, deduplicated', () => {
    const parsed = CreateWebhookEndpointSchema.parse({
      url: '  https://hooks.example.com/steel ',
      events: ['crm.lead.created', 'crm.lead.created', 'crm.deal.won'],
    })
    expect(parsed.url).toBe('https://hooks.example.com/steel')
    expect(parsed.events).toEqual(['crm.lead.created', 'crm.deal.won'])
  })

  it('should collapse any list with * into ["*"]', () => {
    expect(
      CreateWebhookEndpointSchema.parse({
        url: 'https://h.example.com',
        events: ['crm.deal.won', '*'],
      }).events,
    ).toEqual(['*'])
  })

  it.each([
    [
      { url: 'http://h.example.com', events: ['*'] },
      'A URL precisa começar com https://',
    ],
    [{ url: 'nope', events: ['*'] }, 'URL inválida'],
    [{ url: '', events: ['*'] }, 'Informe a URL'],
    [
      { url: 'https://h.example.com', events: [] },
      'Escolha ao menos um evento',
    ],
    [
      { url: 'https://h.example.com', events: ['steel.ping'] },
      'Evento fora do catálogo de webhooks',
    ],
    [
      { url: 'https://h.example.com', events: ['x.y'] },
      'Evento fora do catálogo de webhooks',
    ],
    [
      {
        url: 'https://h.example.com',
        events: ['*'],
        description: 'x'.repeat(201),
      },
      'Descrição longa demais',
    ],
    [
      { url: `https://h.example.com/${'a'.repeat(2048)}`, events: ['*'] },
      'URL longa demais',
    ],
  ])('should refuse %j', (input, message) => {
    const parsed = CreateWebhookEndpointSchema.safeParse(input)
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues.map((issue) => issue.message)).toContain(
      message,
    )
  })
})

describe('UpdateWebhookEndpointSchema', () => {
  it('should accept a partial change and a null description', () => {
    expect(
      UpdateWebhookEndpointSchema.parse({ active: false, description: null }),
    ).toEqual({ active: false, description: null })
  })

  it('should refuse an empty change', () => {
    const parsed = UpdateWebhookEndpointSchema.safeParse({})
    expect(parsed.error?.issues[0]?.message).toBe('Nada para alterar')
  })
})

describe('ListWebhookDeliveriesQuerySchema', () => {
  it('should default the page size and coerce the limit', () => {
    expect(ListWebhookDeliveriesQuerySchema.parse({})).toEqual({ limit: 25 })
    expect(
      ListWebhookDeliveriesQuerySchema.parse({
        limit: '100',
        status: 'FAILED',
      }),
    ).toEqual({ limit: 100, status: 'FAILED' })
  })

  it('should refuse a page over 100 and an unknown status', () => {
    expect(
      ListWebhookDeliveriesQuerySchema.safeParse({ limit: '101' }).success,
    ).toBe(false)
    expect(
      ListWebhookDeliveriesQuerySchema.safeParse({ status: 'DONE' }).success,
    ).toBe(false)
  })
})

describe('TriggerWebhookEventSchema', () => {
  it('should accept any catalog type and refuse others', () => {
    expect(TriggerWebhookEventSchema.parse({ type: 'crm.deal.won' })).toEqual({
      type: 'crm.deal.won',
    })
    expect(TriggerWebhookEventSchema.safeParse({ type: 'x' }).success).toBe(
      false,
    )
  })
})

describe('ListenWebhookQuerySchema', () => {
  it('should split the comma list and ignore blanks and *', () => {
    expect(
      ListenWebhookQuerySchema.parse({
        events: 'crm.deal.won, ,*,servicedesk.ticket.created',
      }),
    ).toEqual({ events: ['crm.deal.won', 'servicedesk.ticket.created'] })
    expect(ListenWebhookQuerySchema.parse({})).toEqual({ events: [] })
  })

  it('should refuse a type outside the catalog', () => {
    expect(ListenWebhookQuerySchema.safeParse({ events: 'nope' }).success).toBe(
      false,
    )
  })

  it('should list every type for the docs', () => {
    expect(WEBHOOK_EVENT_TYPE_VALUES).toContain('steel.ping')
  })
})
