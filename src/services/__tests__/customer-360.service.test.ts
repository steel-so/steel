import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  databaseError,
  forbidden,
  moduleDisabled,
  sdNotAgent,
  whatsappConversationNotFound,
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
vi.mock('@/src/services/whatsapp-conversation-scope.service', () => ({
  loadVisibleConversation: vi.fn(),
  resolveConversationScope: vi.fn(),
}))
vi.mock('@/src/services/whatsapp-conversation.service', () => ({
  WhatsAppConversationService: { start: vi.fn() },
}))
vi.mock('@/src/services/crm-lead-contact-sync', () => ({
  ensureLeadContact: vi.fn(),
}))
vi.mock('@/src/services/crm-lead-whatsapp.service', () => ({
  pickLeadConnection: vi.fn(),
}))
vi.mock('@/src/repositories/customer-360.repository')
vi.mock('@/src/repositories/whatsapp-connection.repository')

import { auditMutation } from '@/lib/axiom/audit'
import { Customer360Repository } from '@/src/repositories/customer-360.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { assertModuleEnabled, assertModuleMember } from '@/src/services/authz'
import { ensureLeadContact } from '@/src/services/crm-lead-contact-sync'
import { pickLeadConnection } from '@/src/services/crm-lead-whatsapp.service'
import { SdAccess } from '@/src/services/sd-access'
import {
  loadVisibleConversation,
  resolveConversationScope,
} from '@/src/services/whatsapp-conversation-scope.service'
import { WhatsAppConversationService } from '@/src/services/whatsapp-conversation.service'
import { Customer360Service } from '../customer-360.service'

const repo = vi.mocked(Customer360Repository)
const member = vi.mocked(assertModuleMember)
const enabled = vi.mocked(assertModuleEnabled)
const agent = vi.mocked(SdAccess.requireAgent)
const scopeOf = vi.mocked(resolveConversationScope)
const visible = vi.mocked(loadVisibleConversation)
const ensure = vi.mocked(ensureLeadContact)
const pick = vi.mocked(pickLeadConnection)
const connections = vi.mocked(WhatsAppConnectionRepository)
const start = vi.mocked(WhatsAppConversationService.start)

const WS = 'ws1'
const ACTOR = 'u1'
const at = new Date('2026-11-13T12:00:00Z')

const privileged = {
  role: 'OWNER',
  isPrivileged: true,
  permissions: null,
} as never
const limited = {
  role: 'MEMBER',
  isPrivileged: false,
  permissions: { people: ['VIEW'] },
} as never
const allScope = {
  mode: 'ALL',
  userId: ACTOR,
  leadsTeamIds: [],
  memberTeamIds: [],
  ledAgentIds: [],
  ledTeamMemberIds: [],
} as never
const scopedScope = {
  mode: 'SCOPED',
  userId: ACTOR,
  leadsTeamIds: [],
  memberTeamIds: [],
  ledAgentIds: [],
  ledTeamMemberIds: [],
} as never

const person = {
  id: 'p1',
  name: 'Ana',
  jobTitle: 'CTO',
  emails: ['ana@acme.com'],
  phones: ['11988887777'],
  companyId: 'c1',
}
const company = {
  id: 'c1',
  name: 'Acme',
  cnpj: null,
  arr: null,
  accountOwnerId: 'u9',
  accountOwner: { name: 'Bia' },
}
const identity = {
  person,
  company,
  sdCustomerIds: ['sc1'],
  sdContactIds: [],
  phones: ['11988887777'],
  emails: ['ana@acme.com'],
  match: 'person' as const,
}

function conversationRow(id: string, assignedUserId: string | null) {
  return {
    id,
    status: 'NEW',
    assignedUserId,
    teamId: null,
    lastMessageAt: at,
    contact: { name: 'Ana', waId: '5511988887777' },
    connection: { label: 'Oficial' },
  }
}

function allowEverything() {
  member.mockResolvedValue(ok(privileged))
  agent.mockResolvedValue(ok({} as never))
  scopeOf.mockResolvedValue(ok(allScope))
  repo.resolveIdentity.mockResolvedValue(ok(identity))
  repo.listOpportunities.mockResolvedValue(
    ok([
      {
        id: 'o1',
        name: 'Plano',
        amount: null,
        closeDate: null,
        updatedAt: at,
        stage: { name: 'Qualificação', category: 'OPEN' },
        pipeline: { name: 'Vendas' },
        owner: null,
      },
    ] as never),
  )
  repo.getHealth.mockResolvedValue(
    ok({
      riskScore: 80,
      level: 'HIGH',
      nextAction: { key: 'k', label: 'Ligar', detail: '' },
      computedAt: at,
    } as never),
  )
  repo.listLeads.mockResolvedValue(
    ok([
      {
        id: 'l1',
        name: 'Lead',
        stage: 'RECEIVED',
        createdAt: at,
        owner: null,
      },
    ] as never),
  )
  repo.listTickets.mockResolvedValue(
    ok({
      rows: [
        {
          id: 't1',
          number: 7,
          title: 'Sem internet',
          type: 'INCIDENT',
          createdAt: at,
          closedAt: null,
          resolvedAt: null,
          resolutionDueAt: null,
          resolutionBreached: false,
          firstResponseBreached: false,
          csatScore: null,
          phase: { name: 'Novo', category: 'NEW' },
          priority: null,
        },
      ],
      open: 1,
    } as never),
  )
  repo.listConversations.mockResolvedValue(
    ok([conversationRow('v1', null)] as never),
  )
  repo.listCalls.mockResolvedValue(
    ok([
      {
        id: 'k1',
        direction: 'OUTBOUND',
        status: 'COMPLETED',
        durationSeconds: 60,
        summary: null,
        conversationId: null,
        createdAt: at,
      },
    ] as never),
  )
  repo.listDocuments.mockResolvedValue(
    ok([
      {
        id: 'd1',
        title: 'Proposta',
        kind: 'PROPOSAL',
        status: 'SENT',
        totalValue: null,
        updatedAt: at,
      },
    ] as never),
  )
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('Customer360Service.get', () => {
  it('assembles every block for a privileged user', async () => {
    allowEverything()
    const dto = expectOk(
      await Customer360Service.get(ACTOR, WS, { personId: 'p1' }),
    )
    expect(dto.match).toBe('person')
    expect(dto.available).toEqual({
      crm: true,
      servicedesk: true,
      whatsapp: true,
    })
    expect(dto.person?.name).toBe('Ana')
    expect(dto.company?.accountOwnerName).toBe('Bia')
    expect(dto.health?.healthScore).toBe(20)
    expect(dto.opportunities).toHaveLength(1)
    expect(dto.leads).toHaveLength(1)
    expect(dto.tickets[0]?.open).toBe(true)
    expect(dto.openTickets).toBe(1)
    expect(dto.conversations).toHaveLength(1)
    expect(dto.calls).toHaveLength(1)
    expect(dto.documents).toHaveLength(1)
    expect(repo.listCalls).toHaveBeenCalledWith(WS, identity, ['o1'])
  })

  it('answers the CRM denial as is', async () => {
    member.mockResolvedValueOnce(err(forbidden()))
    expectErr(
      await Customer360Service.get(ACTOR, WS, { personId: 'p1' }),
      'FORBIDDEN',
    )
    expect(repo.resolveIdentity).not.toHaveBeenCalled()
  })

  it('leaves out the blocks the user may not read', async () => {
    member.mockResolvedValueOnce(ok(limited))
    member.mockResolvedValueOnce(err(moduleDisabled()))
    agent.mockResolvedValue(err(sdNotAgent()))
    repo.resolveIdentity.mockResolvedValue(ok({ ...identity, company: null }))
    const dto = expectOk(
      await Customer360Service.get(ACTOR, WS, { personId: 'p1' }),
    )
    expect(dto.available).toEqual({
      crm: true,
      servicedesk: false,
      whatsapp: false,
    })
    expect(dto.company).toBeNull()
    expect(dto.health).toBeNull()
    expect(dto.opportunities).toEqual([])
    expect(dto.tickets).toEqual([])
    expect(dto.conversations).toEqual([])
    expect(repo.listOpportunities).not.toHaveBeenCalled()
    expect(repo.listLeads).not.toHaveBeenCalled()
    expect(repo.listDocuments).not.toHaveBeenCalled()
    expect(repo.listTickets).not.toHaveBeenCalled()
    expect(repo.listConversations).not.toHaveBeenCalled()
    expect(repo.listCalls).not.toHaveBeenCalled()
    expect(repo.getHealth).not.toHaveBeenCalled()
  })

  it('treats a limited profile with no matrix as read-only people', async () => {
    member.mockResolvedValueOnce(
      ok({ role: 'MEMBER', isPrivileged: false, permissions: null } as never),
    )
    member.mockResolvedValueOnce(err(moduleDisabled()))
    agent.mockResolvedValue(err(sdNotAgent()))
    repo.resolveIdentity.mockResolvedValue(ok(identity))
    const dto = expectOk(
      await Customer360Service.get(ACTOR, WS, { personId: 'p1' }),
    )
    expect(dto.opportunities).toEqual([])
    expect(repo.getHealth).not.toHaveBeenCalled()
  })

  it('hides conversations outside the viewer scope', async () => {
    allowEverything()
    scopeOf.mockResolvedValue(ok(scopedScope))
    repo.listConversations.mockResolvedValue(
      ok([
        conversationRow('mine', ACTOR),
        conversationRow('theirs', 'someone-else'),
      ] as never),
    )
    const dto = expectOk(
      await Customer360Service.get(ACTOR, WS, { personId: 'p1' }),
    )
    expect(dto.conversations.map((c) => c.id)).toEqual(['mine'])
  })

  it('anchors on a ticket and follows its conversation', async () => {
    allowEverything()
    repo.ticketAnchors.mockResolvedValue(
      ok({ sdCustomerId: 'sc1', sdContactId: 'ct1', conversationId: 'cv1' }),
    )
    visible.mockResolvedValue(ok({} as never))
    repo.conversationPhone.mockResolvedValue(ok('5511988887777'))
    expectOk(await Customer360Service.get(ACTOR, WS, { ticketId: 't1' }))
    expect(repo.resolveIdentity).toHaveBeenCalledWith(WS, {
      personId: undefined,
      companyId: undefined,
      phone: '5511988887777',
      sdCustomerId: 'sc1',
      sdContactId: 'ct1',
    })
    expect(repo.listTickets).toHaveBeenCalledWith(WS, identity, 'cv1')
  })

  it('keeps the explicit conversation when a ticket is also given', async () => {
    allowEverything()
    repo.ticketAnchors.mockResolvedValue(
      ok({ sdCustomerId: 'sc1', conversationId: 'from-ticket' }),
    )
    visible.mockResolvedValue(ok({} as never))
    repo.conversationPhone.mockResolvedValue(ok('5511988887777'))
    expectOk(
      await Customer360Service.get(ACTOR, WS, {
        ticketId: 't1',
        conversationId: 'explicit',
      }),
    )
    expect(visible).toHaveBeenCalledWith(allScope, WS, 'explicit')
  })

  it('ignores a ticket that does not exist', async () => {
    allowEverything()
    repo.ticketAnchors.mockResolvedValue(ok(null))
    expectOk(await Customer360Service.get(ACTOR, WS, { ticketId: 'gone' }))
    expect(visible).not.toHaveBeenCalled()
  })

  it('refuses a ticket anchor to someone outside the ServiceDesk', async () => {
    allowEverything()
    agent.mockResolvedValue(err(sdNotAgent()))
    expectErr(
      await Customer360Service.get(ACTOR, WS, { ticketId: 't1' }),
      'SD_NOT_AGENT',
    )
  })

  it('drops the ticket conversation the viewer cannot open', async () => {
    allowEverything()
    repo.ticketAnchors.mockResolvedValue(
      ok({ sdCustomerId: 'sc1', conversationId: 'cv1' }),
    )
    visible.mockResolvedValue(err(whatsappConversationNotFound()))
    expectOk(await Customer360Service.get(ACTOR, WS, { ticketId: 't1' }))
    expect(repo.listTickets).toHaveBeenCalledWith(WS, identity, null)
    expect(repo.conversationPhone).not.toHaveBeenCalled()
  })

  it('skips the ticket conversation when the viewer has no WhatsApp', async () => {
    allowEverything()
    member.mockReset()
    member.mockResolvedValueOnce(ok(privileged))
    member.mockResolvedValueOnce(err(moduleDisabled()))
    repo.ticketAnchors.mockResolvedValue(
      ok({ sdCustomerId: 'sc1', conversationId: 'cv1' }),
    )
    expectOk(await Customer360Service.get(ACTOR, WS, { ticketId: 't1' }))
    expect(visible).not.toHaveBeenCalled()
  })

  it('anchors on an explicit conversation', async () => {
    allowEverything()
    visible.mockResolvedValue(ok({} as never))
    repo.conversationPhone.mockResolvedValue(ok(null))
    expectOk(await Customer360Service.get(ACTOR, WS, { conversationId: 'cv1' }))
    expect(repo.resolveIdentity).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({ phone: undefined }),
    )
  })

  it('does not ask for the phone when one was given', async () => {
    allowEverything()
    expectOk(
      await Customer360Service.get(ACTOR, WS, {
        conversationId: 'cv1',
        phone: '11999990000',
      }),
    )
    expect(visible).not.toHaveBeenCalled()
  })

  it('refuses a conversation anchor without WhatsApp access', async () => {
    allowEverything()
    member.mockReset()
    member.mockResolvedValueOnce(ok(privileged))
    member.mockResolvedValueOnce(err(moduleDisabled()))
    expectErr(
      await Customer360Service.get(ACTOR, WS, { conversationId: 'cv1' }),
      'MODULE_DISABLED',
    )
  })

  it('refuses a conversation the viewer cannot see', async () => {
    allowEverything()
    visible.mockResolvedValue(err(whatsappConversationNotFound()))
    expectErr(
      await Customer360Service.get(ACTOR, WS, { conversationId: 'cv1' }),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    )
  })

  it('propagates a failure reading the conversation phone', async () => {
    allowEverything()
    visible.mockResolvedValue(ok({} as never))
    repo.conversationPhone.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await Customer360Service.get(ACTOR, WS, { conversationId: 'cv1' }),
      'DATABASE_ERROR',
    )
  })

  it('propagates a scope failure', async () => {
    allowEverything()
    scopeOf.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await Customer360Service.get(ACTOR, WS, { personId: 'p1' }),
      'DATABASE_ERROR',
    )
  })

  it('propagates a failure reading the ticket anchors', async () => {
    allowEverything()
    repo.ticketAnchors.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await Customer360Service.get(ACTOR, WS, { ticketId: 't1' }),
      'DATABASE_ERROR',
    )
  })

  it.each([
    'resolveIdentity',
    'listOpportunities',
    'getHealth',
    'listLeads',
    'listTickets',
    'listConversations',
    'listCalls',
    'listDocuments',
  ] as const)('propagates a %s failure', async (name) => {
    allowEverything()
    ;(repo[name] as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      err(databaseError('x')),
    )
    expectErr(
      await Customer360Service.get(ACTOR, WS, { personId: 'p1' }),
      'DATABASE_ERROR',
    )
  })
})

describe('Customer360Service.openWhatsapp', () => {
  const connection = createFakeWhatsAppConnection({ id: 'conn1' })

  function ready() {
    member.mockResolvedValue(ok(privileged))
    enabled.mockResolvedValue(ok(true))
    repo.phoneTargets.mockResolvedValue(
      ok({ name: 'Ana', phones: ['(11) 98888-7777', '(11) 97777-6666'] }),
    )
    ensure.mockResolvedValue(ok({ id: 'wc1' } as never))
    connections.listByWorkspace.mockResolvedValue(ok([connection]))
    pick.mockReturnValue(connection)
    start.mockResolvedValue(ok({ id: 'cv1' } as never))
  }

  it('opens the conversation of the first phone', async () => {
    ready()
    const result = expectOk(
      await Customer360Service.openWhatsapp(ACTOR, WS, { personId: 'p1' }),
    )
    expect(result).toEqual({
      conversationId: 'cv1',
      contactId: 'wc1',
      phone: '(11) 98888-7777',
    })
    expect(member).toHaveBeenCalledWith(ACTOR, WS, 'CRM', {
      resource: 'people',
      action: 'VIEW',
    })
    expect(start).toHaveBeenCalledWith(ACTOR, WS, {
      contactId: 'wc1',
      connectionId: 'conn1',
    })
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'crm_person', targetId: 'p1' }),
    )
  })

  it.each([
    [{ opportunityId: 'o1' }, 'opportunities', 'crm_opportunity', 'o1'],
    [{ companyId: 'c1' }, 'companies', 'crm_company', 'c1'],
  ] as const)('checks %j with the right permission', async (input, resource, entity, id) => {
    ready()
    expectOk(await Customer360Service.openWhatsapp(ACTOR, WS, input))
    expect(member).toHaveBeenCalledWith(ACTOR, WS, 'CRM', {
      resource,
      action: 'VIEW',
    })
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ entity, targetId: id }),
    )
  })

  it('opens the chosen phone', async () => {
    ready()
    const result = expectOk(
      await Customer360Service.openWhatsapp(ACTOR, WS, {
        personId: 'p1',
        phone: '11977776666',
      }),
    )
    expect(result.phone).toBe('(11) 97777-6666')
  })

  it('refuses a phone that is not on the record', async () => {
    ready()
    expectErr(
      await Customer360Service.openWhatsapp(ACTOR, WS, {
        personId: 'p1',
        phone: '11900000000',
      }),
      'VALIDATION_ERROR',
    )
  })

  it('explains a record without phones', async () => {
    ready()
    repo.phoneTargets.mockResolvedValue(ok({ name: 'Ana', phones: [] }))
    const error = expectErr(
      await Customer360Service.openWhatsapp(ACTOR, WS, { personId: 'p1' }),
      'VALIDATION_ERROR',
    )
    expect(error.message).toContain('não tem telefone')
  })

  it('skips an unusable phone and tries the next one', async () => {
    ready()
    ensure.mockResolvedValueOnce(ok(null))
    const result = expectOk(
      await Customer360Service.openWhatsapp(ACTOR, WS, { personId: 'p1' }),
    )
    expect(result.phone).toBe('(11) 97777-6666')
  })

  it('refuses when no phone is usable for WhatsApp', async () => {
    ready()
    ensure.mockResolvedValue(ok(null))
    expectErr(
      await Customer360Service.openWhatsapp(ACTOR, WS, { personId: 'p1' }),
      'VALIDATION_ERROR',
    )
  })

  it('answers the record as not found', async () => {
    ready()
    repo.phoneTargets.mockResolvedValue(ok(null))
    expectErr(
      await Customer360Service.openWhatsapp(ACTOR, WS, { personId: 'p1' }),
      'CRM_PERSON_NOT_FOUND',
    )
    expectErr(
      await Customer360Service.openWhatsapp(ACTOR, WS, { opportunityId: 'o1' }),
      'CRM_OPPORTUNITY_NOT_FOUND',
    )
  })

  it('needs a WhatsApp line', async () => {
    ready()
    pick.mockReturnValue(null)
    expectErr(
      await Customer360Service.openWhatsapp(ACTOR, WS, { personId: 'p1' }),
      'WHATSAPP_CONNECTION_NOT_FOUND',
    )
  })

  it.each([
    ['member', () => member.mockResolvedValue(err(forbidden()))],
    ['module', () => enabled.mockResolvedValue(err(moduleDisabled()))],
    ['phones', () => repo.phoneTargets.mockResolvedValue(err(databaseError('x')))],
    ['contact', () => ensure.mockResolvedValue(err(databaseError('x')))],
    [
      'connections',
      () => connections.listByWorkspace.mockResolvedValue(err(databaseError('x'))),
    ],
    ['start', () => start.mockResolvedValue(err(databaseError('x')))],
  ] as const)('propagates a %s failure', async (_name, fail) => {
    ready()
    fail()
    expectErr(
      await Customer360Service.openWhatsapp(ACTOR, WS, { personId: 'p1' }),
    )
  })
})
