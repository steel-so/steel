import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSteelAgent } from '@/src/__tests__/factories/steel-agent.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  databaseError,
  forbidden,
  notFound,
  sdNotAgent,
  sdTicketClosed,
} from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/steel-agent.repository')
vi.mock('@/src/repositories/crm-lead.repository')
vi.mock('@/src/services/authz', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/services/authz')>()),
  assertModuleMember: vi.fn(),
}))
vi.mock('@/src/services/sd-ticket-tab-support', () => ({
  loadSdTicketTab: vi.fn(),
}))
vi.mock('@/src/services/steel-agent-dispatcher', () => ({
  dispatchSteelAgentDirect: vi.fn().mockResolvedValue(true),
}))

import { CrmLeadRepository } from '@/src/repositories/crm-lead.repository'
import {
  SteelAgentAssignmentRepository,
  SteelAgentRepository,
} from '@/src/repositories/steel-agent.repository'
import { assertModuleMember } from '@/src/services/authz'
import { loadSdTicketTab } from '@/src/services/sd-ticket-tab-support'
import {
  dispatchSteelAgentMentions,
  SteelAgentAssignmentService,
} from '@/src/services/steel-agent-assignment.service'
import { dispatchSteelAgentDirect } from '@/src/services/steel-agent-dispatcher'

const assignments = vi.mocked(SteelAgentAssignmentRepository)
const agents = vi.mocked(SteelAgentRepository)
const leads = vi.mocked(CrmLeadRepository)
const direct = vi.mocked(dispatchSteelAgentDirect)
const tab = vi.mocked(loadSdTicketTab)
const moduleMember = vi.mocked(assertModuleMember)

const agent = createFakeSteelAgent({ id: 'ag1', name: 'Triagem IA' })
const row = {
  id: 'as1',
  workspaceId: 'ws1',
  agentId: 'ag1',
  entityType: 'SD_TICKET' as const,
  entityId: 't1',
  assignedById: 'u1',
  createdAt: new Date('2026-10-29T12:00:00.000Z'),
}

function ticketScope() {
  return ok({
    ticket: { id: 't1', title: 'Rede fora' },
    code: 'INC-000001',
  }) as never
}

beforeEach(() => {
  vi.clearAllMocks()
  direct.mockResolvedValue(true)
  tab.mockResolvedValue(ticketScope())
  moduleMember.mockResolvedValue(ok({}) as never)
  leads.findById.mockResolvedValue(ok({ id: 'l1', name: 'Acme' }) as never)
  agents.findById.mockResolvedValue(ok(agent as never))
  assignments.find.mockResolvedValue(ok(row))
  assignments.upsert.mockResolvedValue(ok(row))
  assignments.remove.mockResolvedValue(ok(1))
})

describe('SteelAgentAssignmentService.get', () => {
  it('should return the assigned agent of a ticket', async () => {
    const result = expectOk(
      await SteelAgentAssignmentService.get('u1', 'ws1', 'SD_TICKET', 'INC-1'),
    )
    expect(tab).toHaveBeenCalledWith('u1', 'ws1', 'INC-1', 'VIEW', {
      agentOnly: true,
      requireOpen: false,
    })
    expect(result).toEqual({
      entityType: 'SD_TICKET',
      entityId: 't1',
      agent: { id: 'ag1', name: 'Triagem IA', enabled: true },
      assignedAt: '2026-10-29T12:00:00.000Z',
    })
  })

  it('should return an empty assignment when nobody holds the record', async () => {
    assignments.find.mockResolvedValue(ok(null))
    const result = expectOk(
      await SteelAgentAssignmentService.get('u1', 'ws1', 'CRM_LEAD', 'l1'),
    )
    expect(result).toEqual({
      entityType: 'CRM_LEAD',
      entityId: 'l1',
      agent: null,
      assignedAt: null,
    })
    expect(moduleMember).toHaveBeenCalledWith('u1', 'ws1', 'CRM', {
      resource: 'leads',
      action: 'VIEW',
    })
  })

  it('should show no agent when the assigned one was deleted', async () => {
    agents.findById.mockResolvedValue(err(notFound('SteelAgent')))
    const result = expectOk(
      await SteelAgentAssignmentService.get('u1', 'ws1', 'SD_TICKET', 't1'),
    )
    expect(result.agent).toBeNull()
    expect(result.assignedAt).toBeNull()
  })

  it('should propagate access and database errors', async () => {
    tab.mockResolvedValue(err(sdNotAgent()))
    expect(
      expectErr(
        await SteelAgentAssignmentService.get('u1', 'ws1', 'SD_TICKET', 't1'),
      ).code,
    ).toBe('SD_NOT_AGENT')

    tab.mockResolvedValue(ticketScope())
    assignments.find.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentAssignmentService.get('u1', 'ws1', 'SD_TICKET', 't1'),
    )
  })
})

describe('SteelAgentAssignmentService.assign', () => {
  it('should assign a ticket and wake the agent with the ticket as context', async () => {
    const result = expectOk(
      await SteelAgentAssignmentService.assign(
        'u1',
        'ws1',
        'SD_TICKET',
        'INC-1',
        { agentId: 'ag1' },
      ),
    )
    expect(tab).toHaveBeenCalledWith('u1', 'ws1', 'INC-1', 'EDIT', {
      agentOnly: true,
      requireOpen: true,
    })
    expect(assignments.upsert).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      agentId: 'ag1',
      entityType: 'SD_TICKET',
      entityId: 't1',
      assignedById: 'u1',
    })
    expect(direct).toHaveBeenCalledWith(
      'ws1',
      'ag1',
      'sd.ticket.agent_assigned',
      {
        ticketId: 't1',
        code: 'INC-000001',
        title: 'Rede fora',
        assignedById: 'u1',
      },
      'u1',
    )
    expect(result.agent?.name).toBe('Triagem IA')
  })

  it('should assign a lead (CRM permission) and wake the agent', async () => {
    assignments.upsert.mockResolvedValue(
      ok({ ...row, entityType: 'CRM_LEAD', entityId: 'l1' }),
    )
    expectOk(
      await SteelAgentAssignmentService.assign('u1', 'ws1', 'CRM_LEAD', 'l1', {
        agentId: 'ag1',
      }),
    )
    expect(moduleMember).toHaveBeenCalledWith('u1', 'ws1', 'CRM', {
      resource: 'leads',
      action: 'EDIT',
    })
    expect(direct).toHaveBeenCalledWith(
      'ws1',
      'ag1',
      'crm.lead.agent_assigned',
      { leadId: 'l1', name: 'Acme', assignedById: 'u1' },
      'u1',
    )
  })

  it('should remove the assignment without running anything', async () => {
    const result = expectOk(
      await SteelAgentAssignmentService.assign('u1', 'ws1', 'SD_TICKET', 't1', {
        agentId: null,
      }),
    )
    expect(assignments.remove).toHaveBeenCalledWith('SD_TICKET', 't1', 'ws1')
    expect(direct).not.toHaveBeenCalled()
    expect(result.agent).toBeNull()
  })

  it('should refuse a paused agent', async () => {
    agents.findById.mockResolvedValue(ok({ ...agent, enabled: false } as never))
    expect(
      expectErr(
        await SteelAgentAssignmentService.assign(
          'u1',
          'ws1',
          'SD_TICKET',
          't1',
          { agentId: 'ag1' },
        ),
      ).code,
    ).toBe('STEEL_AGENT_DISABLED')
    expect(assignments.upsert).not.toHaveBeenCalled()
  })

  it('should refuse an agent of another workspace', async () => {
    agents.findById.mockResolvedValue(err(notFound('SteelAgent')))
    expectErr(
      await SteelAgentAssignmentService.assign('u1', 'ws1', 'CRM_LEAD', 'l1', {
        agentId: 'foreign',
      }),
    )
    expect(direct).not.toHaveBeenCalled()
  })

  it('should deny a user without access to the record', async () => {
    tab.mockResolvedValue(err(sdNotAgent()))
    expectErr(
      await SteelAgentAssignmentService.assign('u1', 'ws1', 'SD_TICKET', 't1', {
        agentId: 'ag1',
      }),
    )
    tab.mockResolvedValue(err(sdTicketClosed()))
    expect(
      expectErr(
        await SteelAgentAssignmentService.assign(
          'u1',
          'ws1',
          'SD_TICKET',
          't1',
          { agentId: 'ag1' },
        ),
      ).code,
    ).toBe('SD_TICKET_CLOSED')

    moduleMember.mockResolvedValue(err(forbidden()))
    expect(
      expectErr(
        await SteelAgentAssignmentService.assign(
          'viewer',
          'ws1',
          'CRM_LEAD',
          'l1',
          { agentId: 'ag1' },
        ),
      ).code,
    ).toBe('FORBIDDEN')
    expect(assignments.upsert).not.toHaveBeenCalled()
  })

  it('should not find a lead from another workspace', async () => {
    leads.findById.mockResolvedValue(err(notFound('CrmLead')))
    expectErr(
      await SteelAgentAssignmentService.assign('u1', 'ws1', 'CRM_LEAD', 'x', {
        agentId: 'ag1',
      }),
    )
  })

  it('should propagate database errors', async () => {
    assignments.upsert.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentAssignmentService.assign('u1', 'ws1', 'SD_TICKET', 't1', {
        agentId: 'ag1',
      }),
    )
    assignments.remove.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentAssignmentService.assign('u1', 'ws1', 'SD_TICKET', 't1', {
        agentId: null,
      }),
    )
  })
})

describe('dispatchSteelAgentMentions', () => {
  const base = {
    workspaceId: 'ws1',
    actorId: 'u1',
    event: 'sd.ticket.agent_mentioned' as const,
    payload: { ticketId: 't1' },
  }

  it('should wake every enabled agent cited once', async () => {
    agents.listEnabledByIds.mockResolvedValue(
      ok([agent, createFakeSteelAgent({ id: 'ag2' })]),
    )
    direct.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const queued = await dispatchSteelAgentMentions({
      ...base,
      agentIds: ['ag1', 'ag1', 'ag2'],
    })
    expect(agents.listEnabledByIds).toHaveBeenCalledWith('ws1', ['ag1', 'ag2'])
    expect(queued).toEqual(['ag1'])
    expect(direct).toHaveBeenCalledWith(
      'ws1',
      'ag1',
      'sd.ticket.agent_mentioned',
      { ticketId: 't1' },
      'u1',
    )
  })

  it('should do nothing without mentions or when the lookup fails', async () => {
    expect(
      await dispatchSteelAgentMentions({ ...base, agentIds: undefined }),
    ).toEqual([])
    expect(await dispatchSteelAgentMentions({ ...base, agentIds: [] })).toEqual(
      [],
    )
    expect(agents.listEnabledByIds).not.toHaveBeenCalled()

    agents.listEnabledByIds.mockResolvedValue(err(databaseError('x')))
    expect(
      await dispatchSteelAgentMentions({ ...base, agentIds: ['ag1'] }),
    ).toEqual([])
  })
})
