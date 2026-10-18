import { describe, expect, it } from 'vitest'
import {
  CreateV1SdTicketCommentSchema,
  ImportV1CrmLeadsQuerySchema,
  ListV1CrmLeadsSchema,
  ListV1CrmOpportunitiesSchema,
  ListV1SdCatalogSchema,
  ListV1SdTicketsSchema,
  ListV1WhatsAppTemplatesSchema,
  MoveV1CrmOpportunityStageSchema,
  SendV1WhatsAppTemplateSchema,
} from '@/src/schemas/api-v1.schema'

describe('ListV1SdTicketsSchema', () => {
  it('reads the curated filters as lists (CSV or repeated keys)', () => {
    expect(
      ListV1SdTicketsSchema.parse({
        status: 'NEW,RESOLVED',
        type: ['INCIDENT', 'CHANGE'],
        phaseId: 'p1, p2',
        priorityId: 'pr1',
        assigneeId: 'me,unassigned',
        q: '  impressora  ',
        limit: '10',
        cursor: 'tk_9',
      }),
    ).toEqual({
      status: ['NEW', 'RESOLVED'],
      type: ['INCIDENT', 'CHANGE'],
      phaseId: ['p1', 'p2'],
      priorityId: ['pr1'],
      assigneeId: ['me', 'unassigned'],
      q: 'impressora',
      limit: 10,
      cursor: 'tk_9',
    })
  })

  it('drops empty values and keeps the page defaults', () => {
    expect(
      ListV1SdTicketsSchema.parse({
        status: '',
        q: '',
        phaseId: ' , ',
        type: null,
      }),
    ).toEqual({ limit: 25 })
  })

  it.each([
    ['an unknown status', { status: 'OPEN' }],
    ['an unknown type', { type: 'BUG' }],
    ['a long search', { q: 'x'.repeat(201) }],
  ])('rejects %s', (_label, input) => {
    expect(ListV1SdTicketsSchema.safeParse(input).success).toBe(false)
  })
})

describe('CreateV1SdTicketCommentSchema', () => {
  it('defaults to a public comment and trims the text', () => {
    expect(CreateV1SdTicketCommentSchema.parse({ body: '  Oi  ' })).toEqual({
      body: 'Oi',
      visibility: 'PUBLIC',
    })
  })

  it.each([
    ['an empty comment', { body: '   ' }],
    ['a comment over the limit', { body: 'x'.repeat(10_001) }],
    ['an unknown visibility', { body: 'oi', visibility: 'PRIVATE' }],
  ])('rejects %s', (_label, input) => {
    expect(CreateV1SdTicketCommentSchema.safeParse(input).success).toBe(false)
  })
})

describe('list queries', () => {
  it('reads the catalog, leads and opportunities filters', () => {
    expect(ListV1SdCatalogSchema.parse({ ticketType: 'INCIDENT' })).toEqual({
      ticketType: 'INCIDENT',
      limit: 25,
    })
    expect(ListV1SdCatalogSchema.parse({ ticketType: '' })).toEqual({
      limit: 25,
    })
    expect(ListV1CrmLeadsSchema.parse({ stage: 'QUALIFIED' })).toEqual({
      stage: 'QUALIFIED',
      limit: 25,
    })
    expect(ListV1CrmLeadsSchema.safeParse({ stage: 'LOST' }).success).toBe(
      false,
    )
    expect(
      ListV1CrmOpportunitiesSchema.parse({ pipelineId: 'p1', stageId: '' }),
    ).toEqual({ pipelineId: 'p1', limit: 25 })
  })

  it('lists approved templates by default, any status with ALL', () => {
    expect(ListV1WhatsAppTemplatesSchema.parse({})).toEqual({
      status: 'APPROVED',
      limit: 25,
    })
    expect(
      ListV1WhatsAppTemplatesSchema.parse({
        status: 'ALL',
        connectionId: 'c1',
      }),
    ).toEqual({ status: 'ALL', connectionId: 'c1', limit: 25 })
    expect(
      ListV1WhatsAppTemplatesSchema.safeParse({ status: 'approved' }).success,
    ).toBe(false)
  })

  it('takes an optional default source for the lead import', () => {
    expect(ImportV1CrmLeadsQuerySchema.parse({})).toEqual({})
    expect(ImportV1CrmLeadsQuerySchema.parse({ source: ' Feira ' })).toEqual({
      source: 'Feira',
    })
    expect(
      ImportV1CrmLeadsQuerySchema.safeParse({ source: 'x'.repeat(101) })
        .success,
    ).toBe(false)
  })
})

describe('MoveV1CrmOpportunityStageSchema', () => {
  it('needs the stage, the pipeline is optional', () => {
    expect(MoveV1CrmOpportunityStageSchema.parse({ stageId: 's1' })).toEqual({
      stageId: 's1',
    })
    expect(MoveV1CrmOpportunityStageSchema.safeParse({}).success).toBe(false)
  })
})

describe('SendV1WhatsAppTemplateSchema', () => {
  const template = { templateName: 'boas_vindas', language: 'pt_BR' }

  it.each([
    ['a conversation', { conversationId: 'cv1' }],
    ['a contact on a connection', { contactId: 'ct1', connectionId: 'cn1' }],
    ['a phone number', { to: '+5511999990000' }],
    [
      'a number without +, on a connection',
      { to: '5511999990000', connectionId: 'cn1' },
    ],
  ])('accepts %s', (_label, target) => {
    expect(
      SendV1WhatsAppTemplateSchema.safeParse({ ...template, ...target })
        .success,
    ).toBe(true)
  })

  it.each([
    ['no target', {}],
    ['a contact without connection', { contactId: 'ct1' }],
    [
      'a conversation and a contact',
      { conversationId: 'cv1', contactId: 'ct1' },
    ],
    [
      'a conversation and a connection',
      { conversationId: 'cv1', connectionId: 'cn1' },
    ],
    [
      'a conversation and a number',
      { conversationId: 'cv1', to: '+5511999990000' },
    ],
    ['a contact and a number', { contactId: 'ct1', to: '+5511999990000' }],
  ])('rejects %s', (_label, target) => {
    const parsed = SendV1WhatsAppTemplateSchema.safeParse({
      ...template,
      ...target,
    })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues[0].message).toBe(
        'Informe um destino: conversationId, contactId e connectionId, ou to',
      )
    }
  })

  it.each([['11999990000x'], ['+0551199999'], ['123']])(
    'rejects %s as a number',
    (to) => {
      expect(
        SendV1WhatsAppTemplateSchema.safeParse({ ...template, to }).success,
      ).toBe(false)
    },
  )
})
