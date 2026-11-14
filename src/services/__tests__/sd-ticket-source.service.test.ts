import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeCrmLead } from '@/src/__tests__/factories/crm-lead.factory'
import { createFakeCrmPerson } from '@/src/__tests__/factories/crm-person.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  databaseError,
  moduleDisabled,
  notFound,
  sdNotAgent,
} from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/services/authz', () => ({
  assertModuleEnabled: vi.fn(),
  assertModuleMember: vi.fn(),
}))
vi.mock('@/src/services/sd-access', () => ({
  SdAccess: { requireAgent: vi.fn() },
}))
vi.mock('@/src/services/sd-ticket.service', () => ({
  SdTicketService: { create: vi.fn() },
}))
vi.mock('@/src/services/sd-ticket-engine', () => ({
  SdTicketEngine: { loadConfig: vi.fn() },
}))
vi.mock('@/src/services/sd-ticket-event-recorder', () => ({
  recordSdTicketEvent: vi.fn(),
}))
vi.mock('@/src/services/whatsapp-conversation-scope.service', () => ({
  loadConversationForViewer: vi.fn(),
}))
vi.mock('@/src/repositories/crm-activity.repository')
vi.mock('@/src/repositories/crm-lead.repository')
vi.mock('@/src/repositories/crm-opportunity.repository')
vi.mock('@/src/repositories/crm-person.repository')
vi.mock('@/src/repositories/phone-call-link.repository')
vi.mock('@/src/repositories/sd-contact.repository')
vi.mock('@/src/repositories/sd-customer.repository')
vi.mock('@/src/repositories/sd-ticket-source.repository')

import { auditMutation } from '@/lib/axiom/audit'
import { CrmActivityRepository } from '@/src/repositories/crm-activity.repository'
import { CrmLeadRepository } from '@/src/repositories/crm-lead.repository'
import { CrmOpportunityRepository } from '@/src/repositories/crm-opportunity.repository'
import { CrmPersonRepository } from '@/src/repositories/crm-person.repository'
import { PhoneCallLinkRepository } from '@/src/repositories/phone-call-link.repository'
import { SdContactRepository } from '@/src/repositories/sd-contact.repository'
import { SdCustomerRepository } from '@/src/repositories/sd-customer.repository'
import { SdTicketSourceRepository } from '@/src/repositories/sd-ticket-source.repository'
import { assertModuleEnabled, assertModuleMember } from '@/src/services/authz'
import { SdAccess } from '@/src/services/sd-access'
import { SdTicketService } from '@/src/services/sd-ticket.service'
import { SdTicketEngine } from '@/src/services/sd-ticket-engine'
import { recordSdTicketEvent } from '@/src/services/sd-ticket-event-recorder'
import { loadConversationForViewer } from '@/src/services/whatsapp-conversation-scope.service'
import { SdTicketSourceService } from '../sd-ticket-source.service'

const access = vi.mocked(SdAccess.requireAgent)
const member = vi.mocked(assertModuleMember)
const enabled = vi.mocked(assertModuleEnabled)
const visible = vi.mocked(loadConversationForViewer)
const sourceRepo = vi.mocked(SdTicketSourceRepository)
const leadRepo = vi.mocked(CrmLeadRepository)
const personRepo = vi.mocked(CrmPersonRepository)
const oppRepo = vi.mocked(CrmOpportunityRepository)
const contactRepo = vi.mocked(SdContactRepository)
const customerRepo = vi.mocked(SdCustomerRepository)
const phoneRepo = vi.mocked(PhoneCallLinkRepository)
const activityRepo = vi.mocked(CrmActivityRepository)
const createTicket = vi.mocked(SdTicketService.create)
const loadConfig = vi.mocked(SdTicketEngine.loadConfig)

const PREFIXES = {
  INCIDENT: 'INC',
  SERVICE_REQUEST: 'REQ',
  CHANGE: 'CHG',
  PROBLEM: 'PRB',
}

const at = new Date('2026-11-13T17:05:00.000Z')

function conversation(module: 'COMMUNICATION' | 'SERVICE_DESK' | 'CRM') {
  return {
    id: 'conv1',
    workspaceId: 'ws1',
    clearedAt: null,
    assignedUserId: null,
    teamId: null,
    connection: { id: 'cn1', module, provider: 'ZAPI' as const },
    contact: { id: 'wc1', name: 'Ana Souza', waId: '5511988887777' },
  }
}

function linkedRow(overrides: Record<string, unknown> = {}): never {
  return {
    id: 'tk1',
    number: 42,
    type: 'SERVICE_REQUEST' as const,
    title: 'Pedido',
    createdAt: at,
    phase: { name: 'Novo', category: 'NEW' },
    ...overrides,
  } as never
}

beforeEach(() => {
  vi.resetAllMocks()
  access.mockResolvedValue(ok({ userId: 'u1' } as never))
  member.mockResolvedValue(ok({ role: 'MEMBER' } as never))
  enabled.mockResolvedValue(ok(true))
  visible.mockResolvedValue(ok({} as never))
  loadConfig.mockResolvedValue(ok({ prefixes: PREFIXES } as never))
  sourceRepo.findWorkspaceMeta.mockResolvedValue(ok({ slug: 'acme' }))
  sourceRepo.findConversation.mockResolvedValue(
    ok(conversation('COMMUNICATION')),
  )
  sourceRepo.listRecentMessages.mockResolvedValue(
    ok([
      {
        direction: 'OUT',
        type: 'TEXT',
        text: 'Olá, como posso ajudar?',
        sentByAi: false,
        createdAt: at,
      },
      {
        direction: 'IN',
        type: 'TEXT',
        text: 'Não consigo acessar o sistema',
        sentByAi: false,
        createdAt: at,
      },
      {
        direction: 'IN',
        type: 'IMAGE',
        text: null,
        sentByAi: false,
        createdAt: at,
      },
    ]),
  )
  sourceRepo.listBySource.mockResolvedValue(ok([]))
  sourceRepo.findCrmCompany.mockResolvedValue(ok(null))
  sourceRepo.findCustomerByName.mockResolvedValue(ok(null))
  sourceRepo.setLinks.mockResolvedValue(ok(undefined))
  sourceRepo.findLinkedTicket.mockResolvedValue(ok(linkedRow()))
  contactRepo.findByChannel.mockResolvedValue(ok(null))
  customerRepo.findByDocument.mockResolvedValue(ok(null))
  phoneRepo.findPersonByPhoneKey.mockResolvedValue(ok(null))
  activityRepo.record.mockResolvedValue(ok({} as never))
  createTicket.mockResolvedValue(
    ok({ id: 'tk1', code: 'REQ-000042', title: 'Pedido' } as never),
  )
})

describe('SdTicketSourceService.preview', () => {
  it('prefills a Comunicação conversation and explains the connection', async () => {
    contactRepo.findByChannel.mockResolvedValue(
      ok({
        id: 'ct1',
        name: 'Ana (contato)',
        customers: [{ customer: { id: 'cu1', name: 'Acme' } }],
      } as never),
    )
    const result = expectOk(
      await SdTicketSourceService.preview('u1', 'ws1', {
        source: 'conversation',
        sourceId: 'conv1',
      }),
    )
    expect(result.title).toBe('Ana Souza: Não consigo acessar o sistema')
    expect(result.messageCount).toBe(3)
    expect(result.descriptionPreview).toContain('Não consigo acessar o sistema')
    expect(result.descriptionPreview).toContain('[imagem]')
    expect(result.contact).toEqual({ id: 'ct1', name: 'Ana (contato)' })
    expect(result.customer).toEqual({ id: 'cu1', name: 'Acme' })
    expect(result.connectionNote).toContain('Comunicação')
    expect(result.requester.phone).toBe('(11) 98888-7777')
    expect(visible).toHaveBeenCalledWith(
      { userId: 'u1', role: 'MEMBER' },
      'ws1',
      'conv1',
    )
  })

  it('lists only open tickets of the source as duplicates', async () => {
    sourceRepo.listBySource.mockResolvedValue(
      ok([
        linkedRow(),
        linkedRow({
          id: 'tk0',
          number: 41,
          phase: { name: 'Fechado', category: 'CLOSED' },
        }),
      ]),
    )
    const result = expectOk(
      await SdTicketSourceService.preview('u1', 'ws1', {
        source: 'conversation',
        sourceId: 'conv1',
      }),
    )
    expect(result.openTickets).toHaveLength(1)
    expect(result.openTickets[0]).toMatchObject({
      code: 'REQ-000042',
      open: true,
      href: '/acme/servicedesk/tickets/42',
    })
  })

  it('names a contact without phone or name and skips the CRM lookup', async () => {
    sourceRepo.findConversation.mockResolvedValue(
      ok({
        ...conversation('COMMUNICATION'),
        contact: { id: 'wc1', name: null, waId: 'BR.123' },
      }),
    )
    const result = expectOk(
      await SdTicketSourceService.preview('u1', 'ws1', {
        source: 'conversation',
        sourceId: 'conv1',
      }),
    )
    expect(result.sourceLabel).toBe('Contato sem nome')
    expect(result.requester.phone).toBeNull()
    expect(phoneRepo.findPersonByPhoneKey).not.toHaveBeenCalled()
  })

  it('refuses requesters without ServiceDesk agent access', async () => {
    access.mockResolvedValue(err(sdNotAgent()))
    expectErr(
      await SdTicketSourceService.preview('u1', 'ws1', {
        source: 'lead',
        sourceId: 'l1',
      }),
      'SD_NOT_AGENT',
    )
  })

  it('answers like a missing conversation when the zap scope hides it', async () => {
    visible.mockResolvedValue(err(notFound('x')))
    expectErr(
      await SdTicketSourceService.preview('u1', 'ws1', {
        source: 'conversation',
        sourceId: 'conv1',
      }),
      'SD_TICKET_SOURCE_NOT_FOUND',
    )
  })

  it('denies a conversation when the Comunicação module is off', async () => {
    member.mockResolvedValue(err(moduleDisabled()))
    expectErr(
      await SdTicketSourceService.preview('u1', 'ws1', {
        source: 'conversation',
        sourceId: 'conv1',
      }),
      'MODULE_DISABLED',
    )
  })

  it('accepts a ServiceDesk conversation without the zap checks', async () => {
    sourceRepo.findConversation.mockResolvedValue(
      ok(conversation('SERVICE_DESK')),
    )
    const result = expectOk(
      await SdTicketSourceService.preview('u1', 'ws1', {
        source: 'conversation',
        sourceId: 'conv1',
      }),
    )
    expect(result.connectionNote).toBeNull()
    expect(member).not.toHaveBeenCalled()
  })

  it('treats a missing, foreign or CRM-connection conversation as not found', async () => {
    sourceRepo.findConversation.mockResolvedValueOnce(ok(null))
    expectErr(
      await SdTicketSourceService.preview('u1', 'ws1', {
        source: 'conversation',
        sourceId: 'x',
      }),
      'SD_TICKET_SOURCE_NOT_FOUND',
    )
    sourceRepo.findConversation.mockResolvedValueOnce(ok(conversation('CRM')))
    expectErr(
      await SdTicketSourceService.preview('u1', 'ws1', {
        source: 'conversation',
        sourceId: 'x',
      }),
      'SD_TICKET_SOURCE_NOT_FOUND',
    )
  })

  it('propagates database errors from every lookup', async () => {
    const input = { source: 'conversation' as const, sourceId: 'conv1' }
    sourceRepo.findConversation.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdTicketSourceService.preview('u1', 'ws1', input),
      'DATABASE_ERROR',
    )
    sourceRepo.listRecentMessages.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdTicketSourceService.preview('u1', 'ws1', input),
      'DATABASE_ERROR',
    )
    contactRepo.findByChannel.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdTicketSourceService.preview('u1', 'ws1', input),
      'DATABASE_ERROR',
    )
    sourceRepo.listBySource.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdTicketSourceService.preview('u1', 'ws1', input),
      'DATABASE_ERROR',
    )
    loadConfig.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdTicketSourceService.preview('u1', 'ws1', input),
      'DATABASE_ERROR',
    )
    sourceRepo.findWorkspaceMeta.mockResolvedValueOnce(ok(null))
    expectErr(
      await SdTicketSourceService.preview('u1', 'ws1', input),
      'SD_TICKET_SOURCE_NOT_FOUND',
    )
  })
})

describe('SdTicketSourceService.create', () => {
  const base = {
    source: 'conversation' as const,
    sourceId: 'conv1',
    type: 'SERVICE_REQUEST' as const,
    includeMessages: true,
    messageCount: 10,
    allowDuplicate: false,
  }

  it('opens the ticket, links the conversation and the CRM person', async () => {
    phoneRepo.findPersonByPhoneKey.mockResolvedValue(ok('p1'))
    contactRepo.findByChannel.mockResolvedValue(
      ok({
        id: 'ct1',
        name: 'Ana',
        customers: [{ customer: { id: 'cu1', name: 'Acme' } }],
      } as never),
    )
    const result = expectOk(
      await SdTicketSourceService.create('u1', 'ws1', base),
    )
    expect(createTicket).toHaveBeenCalledWith(
      'u1',
      'ws1',
      expect.objectContaining({
        type: 'SERVICE_REQUEST',
        channel: 'WHATSAPP',
        contactId: 'ct1',
        customerId: 'cu1',
        title: 'Ana Souza: Não consigo acessar o sistema',
      }),
    )
    expect(createTicket.mock.calls[0][2].description).toContain('<blockquote>')
    expect(sourceRepo.setLinks).toHaveBeenCalledWith('tk1', {
      whatsappConversationId: 'conv1',
      crmPersonId: 'p1',
    })
    expect(recordSdTicketEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'whatsapp.linked', ticketId: 'tk1' }),
    )
    expect(activityRepo.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SD_TICKET_CREATED',
        personId: 'p1',
        entityId: 'tk1',
        summary: expect.stringContaining('REQ-000042'),
      }),
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'sd_ticket', action: 'link' }),
    )
    expect(result.conversationLinked).toBe(true)
    expect(result.ticket.code).toBe('REQ-000042')
  })

  it('skips the CRM link when the CRM module is off', async () => {
    enabled.mockResolvedValue(err(moduleDisabled()))
    expectOk(await SdTicketSourceService.create('u1', 'ws1', base))
    expect(phoneRepo.findPersonByPhoneKey).not.toHaveBeenCalled()
    expect(sourceRepo.setLinks).toHaveBeenCalledWith('tk1', {
      whatsappConversationId: 'conv1',
    })
    expect(activityRepo.record).not.toHaveBeenCalled()
  })

  it('leaves the messages out and honors an explicit title and note', async () => {
    expectOk(
      await SdTicketSourceService.create('u1', 'ws1', {
        ...base,
        includeMessages: false,
        title: 'Meu título',
        note: 'Urgente',
        departmentId: 'd1',
      }),
    )
    const dto = createTicket.mock.calls[0][2]
    expect(dto.title).toBe('Meu título')
    expect(dto.departmentId).toBe('d1')
    expect(dto.description).toContain('Urgente')
    expect(dto.description).not.toContain('<blockquote>')
  })

  it('asks for confirmation when the source already has an open ticket', async () => {
    sourceRepo.listBySource.mockResolvedValue(ok([linkedRow()]))
    const error = expectErr(
      await SdTicketSourceService.create('u1', 'ws1', base),
      'SD_TICKET_SOURCE_HAS_OPEN_TICKET',
    )
    expect(error.message).toContain('REQ-000042')
    expect(createTicket).not.toHaveBeenCalled()

    expectOk(
      await SdTicketSourceService.create('u1', 'ws1', {
        ...base,
        allowDuplicate: true,
      }),
    )
    expect(createTicket).toHaveBeenCalledTimes(1)
  })

  it('ignores closed tickets when checking duplicates', async () => {
    sourceRepo.listBySource.mockResolvedValue(
      ok([linkedRow({ phase: { name: 'Fechado', category: 'CLOSED' } })]),
    )
    expectOk(await SdTicketSourceService.create('u1', 'ws1', base))
  })

  it('refuses without agent access and never creates', async () => {
    access.mockResolvedValue(err(sdNotAgent()))
    expectErr(
      await SdTicketSourceService.create('u1', 'ws1', base),
      'SD_NOT_AGENT',
    )
    expect(createTicket).not.toHaveBeenCalled()
  })

  it('propagates ticket creation errors', async () => {
    createTicket.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdTicketSourceService.create('u1', 'ws1', base),
      'DATABASE_ERROR',
    )
    expect(sourceRepo.setLinks).not.toHaveBeenCalled()
  })

  it('still answers when linking fails after the ticket exists', async () => {
    sourceRepo.setLinks.mockResolvedValue(err(databaseError()))
    const result = expectOk(
      await SdTicketSourceService.create('u1', 'ws1', base),
    )
    expect(result.conversationLinked).toBe(false)
    expect(recordSdTicketEvent).not.toHaveBeenCalled()
  })

  it('keeps going when the timeline write fails', async () => {
    phoneRepo.findPersonByPhoneKey.mockResolvedValue(ok('p1'))
    activityRepo.record.mockResolvedValue(err(databaseError()))
    expectOk(await SdTicketSourceService.create('u1', 'ws1', base))
  })

  it('propagates lookup errors around the creation', async () => {
    sourceRepo.listBySource.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdTicketSourceService.create('u1', 'ws1', base),
      'DATABASE_ERROR',
    )
    contactRepo.findByChannel.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdTicketSourceService.create('u1', 'ws1', base),
      'DATABASE_ERROR',
    )
    sourceRepo.findLinkedTicket.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdTicketSourceService.create('u1', 'ws1', base),
      'DATABASE_ERROR',
    )
    sourceRepo.findLinkedTicket.mockResolvedValueOnce(ok(null))
    expectErr(
      await SdTicketSourceService.create('u1', 'ws1', base),
      'SD_TICKET_SOURCE_NOT_FOUND',
    )
    sourceRepo.findWorkspaceMeta.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdTicketSourceService.create('u1', 'ws1', base),
      'DATABASE_ERROR',
    )
  })
})

describe('SdTicketSourceService.create from CRM records', () => {
  const dto = (
    source: 'lead' | 'person' | 'opportunity',
    sourceId: string,
  ) => ({
    source,
    sourceId,
    type: 'INCIDENT' as const,
    includeMessages: true,
    messageCount: 10,
    allowDuplicate: false,
  })

  it('opens from a lead and links the converted person', async () => {
    leadRepo.findById.mockResolvedValue(
      ok(
        createFakeCrmLead({
          id: 'l1',
          name: 'Acme Lead',
          company: 'Acme',
          phones: ['11988887777'],
          emails: ['a@acme.com'],
          convertedPersonId: 'p9',
        }),
      ),
    )
    sourceRepo.findCustomerByName.mockResolvedValue(
      ok({ id: 'cu1', name: 'Acme' }),
    )
    expectOk(await SdTicketSourceService.create('u1', 'ws1', dto('lead', 'l1')))
    expect(member).toHaveBeenCalledWith('u1', 'ws1', 'CRM', {
      resource: 'leads',
      action: 'VIEW',
    })
    expect(createTicket).toHaveBeenCalledWith(
      'u1',
      'ws1',
      expect.objectContaining({
        channel: 'AGENT',
        customerId: 'cu1',
        title: 'Chamado do lead Acme Lead',
      }),
    )
    expect(sourceRepo.setLinks).toHaveBeenCalledWith('tk1', {
      crmLeadId: 'l1',
      crmPersonId: 'p9',
    })
    expect(activityRepo.record).toHaveBeenCalledWith(
      expect.objectContaining({ personId: 'p9' }),
    )
  })

  it('a lead without a converted person leaves no timeline row', async () => {
    leadRepo.findById.mockResolvedValue(
      ok(createFakeCrmLead({ id: 'l1', name: 'Solo' })),
    )
    expectOk(await SdTicketSourceService.create('u1', 'ws1', dto('lead', 'l1')))
    expect(sourceRepo.setLinks).toHaveBeenCalledWith('tk1', { crmLeadId: 'l1' })
    expect(activityRepo.record).not.toHaveBeenCalled()
  })

  it('opens from a person, matching the customer by CNPJ', async () => {
    personRepo.findById.mockResolvedValue(
      ok(
        createFakeCrmPerson({
          id: 'p1',
          name: 'Bia',
          companyId: 'co1',
          jobTitle: 'CTO',
          emails: ['bia@acme.com'],
          phones: ['11977776666'],
        }),
      ),
    )
    sourceRepo.findCrmCompany.mockResolvedValue(
      ok({ id: 'co1', name: 'Acme SA', cnpj: '12.345.678/0001-90' }),
    )
    customerRepo.findByDocument.mockResolvedValue(
      ok({ id: 'cu2', name: 'Acme SA' } as never),
    )
    expectOk(
      await SdTicketSourceService.create('u1', 'ws1', dto('person', 'p1')),
    )
    expect(customerRepo.findByDocument).toHaveBeenCalledWith(
      'ws1',
      '12345678000190',
    )
    expect(createTicket).toHaveBeenCalledWith(
      'u1',
      'ws1',
      expect.objectContaining({ customerId: 'cu2', title: 'Chamado de Bia' }),
    )
    expect(activityRepo.record).toHaveBeenCalledWith(
      expect.objectContaining({ personId: 'p1', companyId: 'co1' }),
    )
  })

  it('opens from an opportunity with its point of contact and company', async () => {
    oppRepo.findById.mockResolvedValue(
      ok({
        id: 'o1',
        name: 'Plano Pro',
        companyId: 'co1',
        pointOfContactId: 'p1',
      } as never),
    )
    personRepo.findById.mockResolvedValue(
      ok(
        createFakeCrmPerson({ id: 'p1', name: 'Bia', phones: ['11977776666'] }),
      ),
    )
    sourceRepo.findCrmCompany.mockResolvedValue(
      ok({ id: 'co1', name: 'Acme SA', cnpj: null }),
    )
    expectOk(
      await SdTicketSourceService.create('u1', 'ws1', dto('opportunity', 'o1')),
    )
    expect(member).toHaveBeenCalledWith('u1', 'ws1', 'CRM', {
      resource: 'opportunities',
      action: 'VIEW',
    })
    expect(sourceRepo.setLinks).toHaveBeenCalledWith('tk1', {
      crmOpportunityId: 'o1',
      crmPersonId: 'p1',
    })
    expect(activityRepo.record).toHaveBeenCalledWith(
      expect.objectContaining({
        opportunityId: 'o1',
        personId: 'p1',
        companyId: 'co1',
      }),
    )
  })

  it('opens from an opportunity without contact or company', async () => {
    oppRepo.findById.mockResolvedValue(
      ok({
        id: 'o1',
        name: 'Plano',
        companyId: null,
        pointOfContactId: null,
      } as never),
    )
    expectOk(
      await SdTicketSourceService.create('u1', 'ws1', dto('opportunity', 'o1')),
    )
    expect(sourceRepo.setLinks).toHaveBeenCalledWith('tk1', {
      crmOpportunityId: 'o1',
    })
  })

  it.each([
    ['lead', 'leads'],
    ['person', 'people'],
    ['opportunity', 'opportunities'],
  ] as const)('denies %s without CRM access', async (source, resource) => {
    member.mockResolvedValue(err(moduleDisabled()))
    expectErr(
      await SdTicketSourceService.create('u1', 'ws1', dto(source, 'x')),
      'MODULE_DISABLED',
    )
    expect(member).toHaveBeenCalledWith(
      'u1',
      'ws1',
      'CRM',
      expect.objectContaining({ resource }),
    )
  })

  it('propagates missing records and database errors', async () => {
    leadRepo.findById.mockResolvedValue(err(notFound('CrmLead')))
    expectErr(
      await SdTicketSourceService.create('u1', 'ws1', dto('lead', 'x')),
      'RESOURCE_NOT_FOUND',
    )
    personRepo.findById.mockResolvedValue(err(notFound('CrmPerson')))
    expectErr(
      await SdTicketSourceService.create('u1', 'ws1', dto('person', 'x')),
      'RESOURCE_NOT_FOUND',
    )
    oppRepo.findById.mockResolvedValue(err(notFound('CrmOpportunity')))
    expectErr(
      await SdTicketSourceService.create('u1', 'ws1', dto('opportunity', 'x')),
      'RESOURCE_NOT_FOUND',
    )
    personRepo.findById.mockResolvedValue(
      ok(createFakeCrmPerson({ id: 'p1', companyId: 'co1' })),
    )
    sourceRepo.findCrmCompany.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdTicketSourceService.create('u1', 'ws1', dto('person', 'p1')),
      'DATABASE_ERROR',
    )
    oppRepo.findById.mockResolvedValue(
      ok({
        id: 'o1',
        name: 'x',
        companyId: 'co1',
        pointOfContactId: null,
      } as never),
    )
    expectErr(
      await SdTicketSourceService.create('u1', 'ws1', dto('opportunity', 'o1')),
      'DATABASE_ERROR',
    )
  })

  it('propagates customer match errors', async () => {
    personRepo.findById.mockResolvedValue(
      ok(createFakeCrmPerson({ id: 'p1', companyId: 'co1' })),
    )
    sourceRepo.findCrmCompany.mockResolvedValue(
      ok({ id: 'co1', name: 'Acme', cnpj: '12345678000190' }),
    )
    customerRepo.findByDocument.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdTicketSourceService.create('u1', 'ws1', dto('person', 'p1')),
      'DATABASE_ERROR',
    )
    sourceRepo.findCustomerByName.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdTicketSourceService.create('u1', 'ws1', dto('person', 'p1')),
      'DATABASE_ERROR',
    )
  })
})

describe('SdTicketSourceService.listBySource', () => {
  it('lists the linked tickets for an agent', async () => {
    sourceRepo.listBySource.mockResolvedValue(ok([linkedRow()]))
    const list = expectOk(
      await SdTicketSourceService.listBySource('u1', 'ws1', {
        source: 'lead',
        sourceId: 'l1',
      }),
    )
    expect(list).toHaveLength(1)
    expect(access).toHaveBeenCalledWith('u1', 'ws1', {
      resource: 'sd-tickets',
      action: 'VIEW',
    })
  })

  it('refuses non-agents', async () => {
    access.mockResolvedValue(err(sdNotAgent()))
    expectErr(
      await SdTicketSourceService.listBySource('u1', 'ws1', {
        source: 'lead',
        sourceId: 'l1',
      }),
      'SD_NOT_AGENT',
    )
  })
})
