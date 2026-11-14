import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  parseWebhookEventData,
  WEBHOOK_EVENT_EXAMPLES,
} from '@/src/lib/webhooks/events'
import type { CrmCompanyDTO } from '@/types/crm-company'
import type { CrmPersonDTO } from '@/types/crm-person'
import type { DocumentListItemDTO } from '@/types/document'
import type { SdContactDTO } from '@/types/sd-contact'
import type { SdCustomerDTO } from '@/types/sd-customer'
import type { SdKbArticleSummaryDTO } from '@/types/sd-kb-article'
import { emitWebhookEvent } from '../webhook-emitter'
import {
  buildEntityWebhook,
  type EntityWebhook,
  emitEntityWebhook,
} from '../webhook-entity-events'

const emit = vi.mocked(emitWebhookEvent)

const STAMPS = {
  createdAt: '2026-10-18T12:00:00.000Z',
  updatedAt: '2026-10-18T12:05:00.000Z',
}

const person: CrmPersonDTO = {
  id: 'p1',
  name: 'Maria',
  emails: ['maria@example.com'],
  phones: ['+5511999990000'],
  city: null,
  jobTitle: null,
  linkedin: 'https://linkedin.com/in/secret-field',
  avatar: null,
  companyId: 'c1',
  workspaceId: 'w1',
  createdById: 'u1',
  updatedById: null,
  position: 0,
  customFields: { cf_1: 'private' },
  ...STAMPS,
}

const company: CrmCompanyDTO = {
  id: 'c1',
  name: 'Acme',
  cnpj: null,
  domain: 'acme.com.br',
  employees: 10,
  linkedin: null,
  address: null,
  arr: 1000,
  icp: true,
  workspaceId: 'w1',
  createdById: 'u1',
  accountOwnerId: 'u2',
  updatedById: null,
  position: 0,
  ...STAMPS,
}

const document: DocumentListItemDTO = {
  id: 'd1',
  workspaceId: 'w1',
  title: 'Proposta',
  kind: 'PROPOSAL',
  status: 'DRAFT',
  isTemplate: false,
  source: 'BLANK',
  owner: { id: 'u1', name: 'Ana', image: null },
  company: { id: 'c1', name: 'Acme' },
  person: null,
  opportunity: null,
  lead: null,
  totalValue: 100,
  validUntil: null,
  sentAt: null,
  firstViewedAt: null,
  lastViewedAt: null,
  acceptedAt: null,
  viewCount: 0,
  ...STAMPS,
}

const customer: SdCustomerDTO = {
  id: 's1',
  workspaceId: 'w1',
  kind: 'COMPANY',
  personType: 'LEGAL',
  name: 'Acme',
  tradeName: null,
  document: null,
  email: null,
  phone: null,
  whatsapp: null,
  zipCode: null,
  street: null,
  number: null,
  complement: null,
  district: null,
  city: null,
  state: null,
  country: 'BR',
  ibgeCode: null,
  notes: 'internal note',
  customFields: {},
  active: true,
  contactsCount: 0,
  configItemsCount: 0,
  createdById: 'u1',
  ...STAMPS,
}

const contact: SdContactDTO = {
  id: 'k1',
  workspaceId: 'w1',
  name: 'Carlos',
  jobTitle: null,
  email: null,
  phone: null,
  whatsapp: null,
  userId: null,
  user: null,
  notes: 'internal note',
  customFields: {},
  active: true,
  customers: [
    { id: 's1', name: 'Acme', kind: 'COMPANY', isPrimary: true },
    { id: 's2', name: 'Beta', kind: 'COMPANY', isPrimary: false },
  ],
  createdById: 'u1',
  ...STAMPS,
}

const article: SdKbArticleSummaryDTO = {
  id: 'a1',
  workspaceId: 'w1',
  parentId: null,
  title: 'VPN',
  icon: null,
  coverImage: null,
  status: 'PUBLISHED',
  visibility: 'PORTAL',
  categoryId: null,
  tags: ['vpn'],
  position: 0,
  viewCount: 5,
  helpfulCount: 0,
  notHelpfulCount: 0,
  reuseCount: 0,
  sourceTicketId: null,
  reviewIntervalDays: null,
  reviewDueAt: null,
  lastReviewedAt: null,
  publishedAt: STAMPS.updatedAt,
  archivedAt: null,
  ...STAMPS,
}

const CASES: { event: EntityWebhook; type: string }[] = [
  {
    event: {
      entity: 'person',
      action: 'created',
      record: person,
    },
    type: 'crm.person.created',
  },
  {
    event: {
      entity: 'person',
      action: 'deleted',
      record: person,
    },
    type: 'crm.person.deleted',
  },
  {
    event: {
      entity: 'company',
      action: 'updated',
      record: company,
    },
    type: 'crm.company.updated',
  },
  {
    event: {
      entity: 'document',
      action: 'created',
      record: document,
    },
    type: 'crm.document.created',
  },
  {
    event: {
      entity: 'document',
      action: 'sent',
      record: document,
      recipients: 2,
    },
    type: 'crm.document.sent',
  },
  {
    event: {
      entity: 'sd_customer',
      action: 'created',
      record: customer,
    },
    type: 'servicedesk.customer.created',
  },
  {
    event: {
      entity: 'sd_contact',
      action: 'updated',
      record: contact,
    },
    type: 'servicedesk.contact.updated',
  },
  {
    event: {
      entity: 'kb_article',
      action: 'published',
      record: article,
    },
    type: 'servicedesk.kb_article.published',
  },
  {
    event: {
      entity: 'kb_article',
      action: 'unpublished',
      record: article,
    },
    type: 'servicedesk.kb_article.unpublished',
  },
  {
    event: {
      entity: 'kb_article',
      action: 'deleted',
      record: article,
    },
    type: 'servicedesk.kb_article.deleted',
  },
]

beforeEach(() => {
  emit.mockClear()
})

describe('buildEntityWebhook', () => {
  it.each(CASES)('should build a catalog-valid payload for $type', (entry) => {
    const { event, type } = entry
    const built = buildEntityWebhook(event, 'u9')
    expect(built.type).toBe(type)
    expect(parseWebhookEventData(built.type, built.data).success).toBe(true)
  })

  it('should not leak internal fields of the records', () => {
    const built = buildEntityWebhook(
      { entity: 'person', action: 'created', record: person },
      'u9',
    )
    const json = JSON.stringify(built.data)
    expect(json).not.toContain('secret-field')
    expect(json).not.toContain('private')
    expect(json).not.toContain('workspaceId')
    const contactBuilt = buildEntityWebhook(
      { entity: 'sd_contact', action: 'created', record: contact },
      null,
    )
    expect(JSON.stringify(contactBuilt.data)).not.toContain('internal note')
  })

  it('should carry the actor, the document owner and the linked ids', () => {
    const doc = buildEntityWebhook(
      { entity: 'document', action: 'created', record: document },
      'u9',
    )
    expect(doc.data).toMatchObject({
      actorId: 'u9',
      document: { ownerId: 'u1', companyId: 'c1', personId: null },
    })
    const linked = buildEntityWebhook(
      { entity: 'sd_contact', action: 'created', record: contact },
      'u9',
    )
    expect(linked.data).toMatchObject({
      contact: { customerIds: ['s1', 's2'] },
    })
  })

  it('should build the public answers of a document without an actor', () => {
    const built = buildEntityWebhook(
      {
        entity: 'document_answer',
        action: 'declined',
        document: { id: 'd1', title: 'Proposta', ownerId: 'u1' },
        reader: { name: 'Maria', email: null },
        reason: 'Caro',
      },
      null,
    )
    expect(built.type).toBe('crm.document.declined')
    expect(built.data).toEqual({
      document: { id: 'd1', title: 'Proposta', ownerId: 'u1' },
      reader: { name: 'Maria', email: null },
      reason: 'Caro',
    })
  })

  it('should have an example for every type it can emit', () => {
    for (const { event } of CASES) {
      const built = buildEntityWebhook(event, null)
      expect(WEBHOOK_EVENT_EXAMPLES[built.type]).toBeDefined()
    }
  })
})

describe('emitEntityWebhook', () => {
  it('should hand the type and data to the emitter of the workspace', async () => {
    await emitEntityWebhook('w1', 'u9', {
      entity: 'company',
      action: 'created',
      record: company,
    })
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith(
      'w1',
      'crm.company.created',
      expect.objectContaining({ actorId: 'u9' }),
    )
  })

  it('should swallow a record that cannot be mapped', async () => {
    await expect(
      emitEntityWebhook('w1', null, {
        entity: 'sd_contact',
        action: 'created',
        record: { ...contact, customers: undefined as never },
      }),
    ).resolves.toBeUndefined()
    expect(emit).not.toHaveBeenCalled()
  })
})
