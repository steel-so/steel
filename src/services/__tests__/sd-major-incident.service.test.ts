import type { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeSdMajorIncident,
  createFakeSdMajorIncidentSummary,
  createFakeSdStatusPage,
} from '@/src/__tests__/factories/nov-s2-major-incident.factory'
import { createFakeSdTicket } from '@/src/__tests__/factories/sd-ticket.factory'
import {
  createFakeSdPhase,
  createFakeSdSettings,
} from '@/src/__tests__/factories/sd-ticket-context.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, sdTicketNotFound } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import { DEFAULT_SD_TICKET_PREFIXES } from '@/src/lib/servicedesk/ticket-code'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/sd-access.repository')
vi.mock('@/src/repositories/sd-major-incident.repository')
vi.mock('@/src/repositories/sd-status-page.repository')
vi.mock('@/src/repositories/sd-ticket-context.repository')
vi.mock('@/lib/axiom/audit')
vi.mock('@/src/lib/servicedesk/status-notify-queue', () => ({
  enqueueSdStatusUpdateNotice: vi.fn(),
}))
vi.mock('../sd-ticket-event-recorder', () => ({
  recordSdTicketEvent: vi.fn(),
  sdEventActorKind: () => 'AGENT',
}))
vi.mock('../sd-notification.service', () => ({
  notifySdEvent: vi.fn(async () => ({ ok: true, value: {} })),
}))
vi.mock('../sd-swarm.service', () => ({
  SdSwarmService: { start: vi.fn() },
}))
vi.mock('../sd-major-incident-link', () => ({
  SdMajorIncidentLinker: { attach: vi.fn() },
}))
vi.mock('../sd-ticket-engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sd-ticket-engine')>()),
  SdTicketEngine: {
    loadConfig: vi.fn(),
    resolveRef: vi.fn(),
    changePhase: vi.fn(),
  },
}))

import { auditMutation } from '@/lib/axiom/audit'
import { enqueueSdStatusUpdateNotice } from '@/src/lib/servicedesk/status-notify-queue'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { SdAccessRepository } from '@/src/repositories/sd-access.repository'
import { SdMajorIncidentRepository } from '@/src/repositories/sd-major-incident.repository'
import { SdStatusPageRepository } from '@/src/repositories/sd-status-page.repository'
import { SdTicketContextRepository } from '@/src/repositories/sd-ticket-context.repository'
import { SdMajorIncidentService } from '../sd-major-incident.service'
import { SdMajorIncidentLinker } from '../sd-major-incident-link'
import { notifySdEvent } from '../sd-notification.service'
import { SdSwarmService } from '../sd-swarm.service'
import { SdTicketEngine } from '../sd-ticket-engine'
import { recordSdTicketEvent } from '../sd-ticket-event-recorder'

const config = {
  settings: createFakeSdSettings(),
  prefixes: DEFAULT_SD_TICKET_PREFIXES,
}
const repo = vi.mocked(SdMajorIncidentRepository)
const pages = vi.mocked(SdStatusPageRepository)
const ctxRepo = vi.mocked(SdTicketContextRepository)
const engine = vi.mocked(SdTicketEngine)
const swarm = vi.mocked(SdSwarmService)
const linker = vi.mocked(SdMajorIncidentLinker)
const notify = vi.mocked(notifySdEvent)

const WS = 'ws1'
const master = createFakeSdTicket({
  id: 't1',
  number: 7,
  customerId: 'c1',
  requesterId: 'req',
})
const child = createFakeSdTicket({ id: 't2', number: 8 })
const incident = createFakeSdMajorIncident({ id: 'i1' })
const summary = createFakeSdMajorIncidentSummary({ id: 'i1' })
const user = { id: 'agent', name: 'Ana', email: 'a@x.com', image: null }

function as(who: 'agent' | 'requester', role: Role = 'MEMBER') {
  vi.mocked(MembershipRepository).findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
  vi.mocked(SdAccessRepository).listDepartmentLinks.mockResolvedValue(
    ok(
      who === 'agent'
        ? [{ departmentId: 'd', parentId: null, isLead: false }]
        : [],
    ),
  )
}

const refs: Record<string, ReturnType<typeof createFakeSdTicket>> = {
  t1: master,
  t2: child,
  'INC-000007': master,
  '8': child,
  'INC-000008': child,
}

beforeEach(() => {
  vi.clearAllMocks()
  as('agent')
  engine.loadConfig.mockResolvedValue(ok(config))
  engine.resolveRef.mockImplementation(async (_ws, ref) =>
    refs[ref] ? ok(refs[ref]) : err(sdTicketNotFound()),
  )
  ctxRepo.findNonMembers.mockResolvedValue(ok([]))
  repo.findUsers.mockResolvedValue(ok(new Map([['agent', user]])))
  repo.findById.mockResolvedValue(ok(incident))
  repo.findActiveByTicket.mockResolvedValue(ok(null))
  repo.create.mockResolvedValue(ok(incident))
  repo.update.mockResolvedValue(ok(incident))
  repo.addUpdate.mockResolvedValue(ok(incident.updates[0]))
  repo.resolve.mockResolvedValue(ok(incident.updates[0]))
  repo.setSwarm.mockResolvedValue(ok(true))
  repo.list.mockResolvedValue(ok([summary]))
  repo.listForTicket.mockResolvedValue(ok({ master: [], child: [] }))
  repo.linkedTicketIds.mockResolvedValue(ok([]))
  repo.unlinkTicket.mockResolvedValue(ok(true))
  repo.countPages.mockResolvedValue(ok(1))
  repo.findRelatedTickets.mockResolvedValue(ok([]))
  pages.list.mockResolvedValue(
    ok([
      createFakeSdStatusPage({ id: 'p-open' }),
      createFakeSdStatusPage({ id: 'p-c1', customerId: 'c1' }),
      createFakeSdStatusPage({ id: 'p-other', customerId: 'zz' }),
      createFakeSdStatusPage({ id: 'p-off', published: false }),
    ]),
  )
  linker.attach.mockResolvedValue(ok({ linked: true }))
  swarm.start.mockResolvedValue(
    ok({ id: 'sw1', slack: { status: 'NONE', error: null } } as never),
  )
})

describe('SdMajorIncidentService.list/get', () => {
  it('lists for agents and maps the summaries', async () => {
    const out = expectOk(
      await SdMajorIncidentService.list('agent', WS, {
        status: 'ACTIVE',
        limit: 10,
      }),
    )
    expect(out.items[0]).toMatchObject({ id: 'i1', ticketCode: 'INC-000007' })
    expect(repo.list).toHaveBeenCalledWith({
      workspaceId: WS,
      filter: 'ACTIVE',
      limit: 10,
    })
  })

  it('denies requesters and propagates repository errors', async () => {
    as('requester')
    expectErr(
      await SdMajorIncidentService.list('req', WS, { status: 'ALL', limit: 5 }),
      'SD_NOT_AGENT',
    )
    as('agent')
    repo.list.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdMajorIncidentService.list('agent', WS, {
        status: 'ALL',
        limit: 5,
      }),
      'DATABASE_ERROR',
    )
    repo.list.mockResolvedValue(ok([summary]))
    repo.findUsers.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdMajorIncidentService.list('agent', WS, {
        status: 'ALL',
        limit: 5,
      }),
      'DATABASE_ERROR',
    )
    engine.loadConfig.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdMajorIncidentService.list('agent', WS, {
        status: 'ALL',
        limit: 5,
      }),
      'DATABASE_ERROR',
    )
  })

  it('gets the full incident, not found and user errors', async () => {
    const out = expectOk(await SdMajorIncidentService.get('agent', WS, 'i1'))
    expect(out.children[0].code).toBe('INC-000008')
    expect(out.updates).toHaveLength(1)
    repo.findById.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdMajorIncidentService.get('agent', WS, 'i1'),
      'DATABASE_ERROR',
    )
    repo.findById.mockResolvedValue(ok(incident))
    repo.findUsers.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdMajorIncidentService.get('agent', WS, 'i1'),
      'DATABASE_ERROR',
    )
  })
})

describe('SdMajorIncidentService.forTicket', () => {
  it('offers to declare an incident ticket with the matching pages', async () => {
    const out = expectOk(
      await SdMajorIncidentService.forTicket('agent', WS, 't1'),
    )
    expect(out.canDeclare).toBe(true)
    expect(out.master).toBeNull()
    expect(out.suggestedPageIds.sort()).toEqual(['p-c1', 'p-open'])
  })

  it('shows the master and the child incidents', async () => {
    repo.listForTicket.mockResolvedValue(
      ok({ master: [summary], child: [summary] }),
    )
    const both = expectOk(
      await SdMajorIncidentService.forTicket('agent', WS, 't1'),
    )
    expect(both.canDeclare).toBe(false)
    expect(both.master?.id).toBe('i1')
    expect(both.child?.id).toBe('i1')

    repo.listForTicket.mockResolvedValue(ok({ master: [], child: [summary] }))
    const onlyChild = expectOk(
      await SdMajorIncidentService.forTicket('agent', WS, 't1'),
    )
    expect(onlyChild.master).toBeNull()
    expect(onlyChild.child?.id).toBe('i1')

    repo.listForTicket.mockResolvedValue(
      ok({
        master: [{ ...summary, status: 'RESOLVED' }],
        child: [],
      }),
    )
    const resolvedOnly = expectOk(
      await SdMajorIncidentService.forTicket('agent', WS, 't1'),
    )
    expect(resolvedOnly.master).toBeNull()
    expect(resolvedOnly.canDeclare).toBe(true)
  })

  it('does not offer a declaration for other ticket types', async () => {
    refs.t1 = createFakeSdTicket({ id: 't1', type: 'CHANGE' })
    const out = expectOk(
      await SdMajorIncidentService.forTicket('agent', WS, 't1'),
    )
    refs.t1 = master
    expect(out.canDeclare).toBe(false)
    expect(out.suggestedPageIds).toEqual([])
  })

  it('denies requesters and propagates errors', async () => {
    as('requester')
    expectErr(
      await SdMajorIncidentService.forTicket('req', WS, 't1'),
      'SD_NOT_AGENT',
    )
    as('agent')
    repo.listForTicket.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdMajorIncidentService.forTicket('agent', WS, 't1'),
      'DATABASE_ERROR',
    )
    repo.listForTicket.mockResolvedValue(ok({ master: [], child: [] }))
    pages.list.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdMajorIncidentService.forTicket('agent', WS, 't1'),
      'DATABASE_ERROR',
    )
    repo.findUsers.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdMajorIncidentService.forTicket('agent', WS, 't1'),
      'DATABASE_ERROR',
    )
  })
})

describe('SdMajorIncidentService.declare', () => {
  const input = {
    ticketRef: 't1',
    title: 'Telefonia fora',
    impact: 'MAJOR_OUTAGE' as const,
    publishInitial: true,
  }

  it('declares with the auto-matched pages, children and side effects', async () => {
    const out = expectOk(
      await SdMajorIncidentService.declare('agent', WS, {
        ...input,
        childTicketRefs: ['8', '8', 'INC-000007', 'nope'],
      }),
    )
    expect(out.incident.id).toBe('i1')
    expect(out.warnings).toHaveLength(2)
    expect(out.warnings.join(' ')).toContain('nope')
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: 't1',
        commanderId: 'agent',
        impact: 'MAJOR_OUTAGE',
        pageIds: ['p-open', 'p-c1'],
        children: [{ ticketId: 't2', source: 'MANUAL' }],
        firstUpdate: expect.objectContaining({ publish: true }),
      }),
    )
    expect(recordSdTicketEvent).toHaveBeenCalledWith([
      expect.objectContaining({ action: 'major_incident.declared' }),
      expect.objectContaining({
        ticketId: 't2',
        action: 'major_incident.linked',
      }),
    ])
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'major_incident.declared' }),
    )
    expect(enqueueSdStatusUpdateNotice).toHaveBeenCalledWith('u1')
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'sd_major_incident',
        action: 'create',
      }),
    )
    expect(swarm.start).not.toHaveBeenCalled()
  })

  it('uses the given pages, commander and message', async () => {
    const out = expectOk(
      await SdMajorIncidentService.declare('agent', WS, {
        ...input,
        commanderId: 'boss',
        pageIds: ['p1', 'p1'],
        initialMessage: 'Olá cliente',
        publishInitial: false,
      }),
    )
    expect(out.warnings).toEqual([])
    expect(ctxRepo.findNonMembers).toHaveBeenCalledWith(WS, ['boss'])
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        commanderId: 'boss',
        pageIds: ['p1'],
        firstUpdate: { message: 'Olá cliente', publish: false },
      }),
    )
  })

  it('does not publish the first update without pages or with the update unpublished', async () => {
    repo.create.mockResolvedValue(
      ok({
        ...incident,
        updates: [{ ...incident.updates[0], publish: false }],
      }),
    )
    expectOk(
      await SdMajorIncidentService.declare('agent', WS, {
        ...input,
        pageIds: [],
      }),
    )
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        firstUpdate: expect.objectContaining({ publish: false }),
      }),
    )
    expect(enqueueSdStatusUpdateNotice).not.toHaveBeenCalled()
  })

  it('opens the war room and reports Slack and swarm failures as warnings', async () => {
    const withWar = {
      ...input,
      warRoom: { userIds: ['s1'], openSlackChannel: true },
    }
    expectOk(await SdMajorIncidentService.declare('agent', WS, withWar))
    expect(swarm.start).toHaveBeenCalledWith(
      'agent',
      WS,
      't1',
      expect.objectContaining({ userIds: ['s1'], openSlackChannel: true }),
    )
    expect(repo.setSwarm).toHaveBeenCalledWith('i1', 'sw1')

    swarm.start.mockResolvedValue(
      ok({
        id: 'sw1',
        slack: { status: 'FAILED', error: 'sem Slack' },
      } as never),
    )
    const slackFail = expectOk(
      await SdMajorIncidentService.declare('agent', WS, withWar),
    )
    expect(slackFail.warnings[0]).toContain('sem Slack')

    swarm.start.mockResolvedValue(
      ok({ id: 'sw1', slack: { status: 'FAILED', error: null } } as never),
    )
    const unknown = expectOk(
      await SdMajorIncidentService.declare('agent', WS, withWar),
    )
    expect(unknown.warnings[0]).toContain('erro desconhecido')

    swarm.start.mockResolvedValue(err(databaseError()))
    const failed = expectOk(
      await SdMajorIncidentService.declare('agent', WS, withWar),
    )
    expect(failed.warnings[0]).toContain('sala de guerra não foi aberta')
  })

  it('refuses invalid tickets, duplicates, outsiders and foreign pages', async () => {
    refs.t1 = createFakeSdTicket({ id: 't1', type: 'CHANGE' })
    expectErr(
      await SdMajorIncidentService.declare('agent', WS, input),
      'SD_MAJOR_INCIDENT_INVALID_TICKET',
    )
    refs.t1 = master

    repo.findActiveByTicket.mockResolvedValue(ok(summary))
    expectErr(
      await SdMajorIncidentService.declare('agent', WS, input),
      'SD_MAJOR_INCIDENT_ALREADY_ACTIVE',
    )
    repo.findActiveByTicket.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdMajorIncidentService.declare('agent', WS, input),
      'DATABASE_ERROR',
    )
    repo.findActiveByTicket.mockResolvedValue(ok(null))

    ctxRepo.findNonMembers.mockResolvedValue(ok(['boss']))
    expectErr(
      await SdMajorIncidentService.declare('agent', WS, {
        ...input,
        commanderId: 'boss',
      }),
      'VALIDATION_ERROR',
    )
    ctxRepo.findNonMembers.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdMajorIncidentService.declare('agent', WS, {
        ...input,
        commanderId: 'boss',
      }),
      'DATABASE_ERROR',
    )
    ctxRepo.findNonMembers.mockResolvedValue(ok([]))

    repo.countPages.mockResolvedValue(ok(0))
    expectErr(
      await SdMajorIncidentService.declare('agent', WS, {
        ...input,
        pageIds: ['x'],
      }),
      'VALIDATION_ERROR',
    )
    repo.countPages.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdMajorIncidentService.declare('agent', WS, {
        ...input,
        pageIds: ['x'],
      }),
      'DATABASE_ERROR',
    )
    pages.list.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdMajorIncidentService.declare('agent', WS, input),
      'DATABASE_ERROR',
    )
    pages.list.mockResolvedValue(ok([]))
    repo.create.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdMajorIncidentService.declare('agent', WS, input),
      'DATABASE_ERROR',
    )
  })

  it('denies non-agents and closed tickets', async () => {
    as('requester')
    expectErr(
      await SdMajorIncidentService.declare('req', WS, input),
      'SD_NOT_AGENT',
    )
    as('agent')
    refs.t1 = createFakeSdTicket({
      id: 't1',
      phase: { ...master.phase, category: 'CLOSED' },
    })
    expectErr(
      await SdMajorIncidentService.declare('agent', WS, input),
      'SD_TICKET_CLOSED',
    )
    refs.t1 = master
  })

  it('survives notification and reload failures', async () => {
    notify.mockResolvedValueOnce(err(databaseError()))
    repo.findById.mockResolvedValue(err(databaseError()))
    expectOk(await SdMajorIncidentService.declare('agent', WS, input))
    repo.findUsers.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdMajorIncidentService.declare('agent', WS, input),
      'DATABASE_ERROR',
    )
  })
})

describe('SdMajorIncidentService.update', () => {
  it('updates and audits', async () => {
    const out = expectOk(
      await SdMajorIncidentService.update('agent', WS, 'i1', {
        title: 'Novo',
        commanderId: 'boss',
        pageIds: ['p1', 'p1'],
      }),
    )
    expect(out.id).toBe('i1')
    expect(repo.update).toHaveBeenCalledWith('i1', WS, {
      title: 'Novo',
      commanderId: 'boss',
      pageIds: ['p1'],
    })
    expect(auditMutation).toHaveBeenCalled()
    expectOk(
      await SdMajorIncidentService.update('agent', WS, 'i1', { summary: null }),
    )
  })

  it('refuses resolved incidents, outsiders, foreign pages and db errors', async () => {
    repo.findById.mockResolvedValue(ok({ ...incident, status: 'RESOLVED' }))
    expectErr(
      await SdMajorIncidentService.update('agent', WS, 'i1', {
        title: 'x y z',
      }),
      'SD_MAJOR_INCIDENT_RESOLVED',
    )
    repo.findById.mockResolvedValue(ok(incident))
    ctxRepo.findNonMembers.mockResolvedValue(ok(['boss']))
    expectErr(
      await SdMajorIncidentService.update('agent', WS, 'i1', {
        commanderId: 'boss',
      }),
      'VALIDATION_ERROR',
    )
    ctxRepo.findNonMembers.mockResolvedValue(ok([]))
    repo.countPages.mockResolvedValue(ok(0))
    expectErr(
      await SdMajorIncidentService.update('agent', WS, 'i1', {
        pageIds: ['x'],
      }),
      'VALIDATION_ERROR',
    )
    repo.countPages.mockResolvedValue(ok(1))
    repo.update.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdMajorIncidentService.update('agent', WS, 'i1', {
        title: 'x y z',
      }),
      'DATABASE_ERROR',
    )
    as('requester')
    expectErr(
      await SdMajorIncidentService.update('req', WS, 'i1', { title: 'x y z' }),
      'SD_NOT_AGENT',
    )
  })
})

describe('SdMajorIncidentService.addUpdate', () => {
  const input = {
    status: 'IDENTIFIED' as const,
    message: 'Causa achada',
    publish: true,
  }

  it('publishes to the pages, writes the timelines and enqueues the notice', async () => {
    expectOk(await SdMajorIncidentService.addUpdate('agent', WS, 'i1', input))
    expect(repo.addUpdate).toHaveBeenCalledWith(
      'i1',
      WS,
      expect.objectContaining({ publish: true, status: 'IDENTIFIED' }),
    )
    const events = vi.mocked(recordSdTicketEvent).mock.calls[0][0] as {
      ticketId: string
      action: string
    }[]
    expect(events.map((e) => e.ticketId)).toEqual(['t1', 't2'])
    expect(events[0].action).toBe('major_incident.updated')
    expect(enqueueSdStatusUpdateNotice).toHaveBeenCalledWith('u1')
  })

  it('stays internal without pages or when asked', async () => {
    repo.findById.mockResolvedValue(ok({ ...incident, pages: [] }))
    expectOk(await SdMajorIncidentService.addUpdate('agent', WS, 'i1', input))
    expect(repo.addUpdate).toHaveBeenLastCalledWith(
      'i1',
      WS,
      expect.objectContaining({ publish: false }),
    )
    repo.findById.mockResolvedValue(ok(incident))
    expectOk(
      await SdMajorIncidentService.addUpdate('agent', WS, 'i1', {
        ...input,
        publish: false,
      }),
    )
    expect(enqueueSdStatusUpdateNotice).not.toHaveBeenCalled()
    const events = vi.mocked(recordSdTicketEvent).mock.calls.at(-1)?.[0] as {
      ticketId: string
    }[]
    expect(events.map((e) => e.ticketId)).toEqual(['t1'])
  })

  it('refuses resolved incidents and propagates errors', async () => {
    repo.findById.mockResolvedValue(ok({ ...incident, status: 'RESOLVED' }))
    expectErr(
      await SdMajorIncidentService.addUpdate('agent', WS, 'i1', input),
      'SD_MAJOR_INCIDENT_RESOLVED',
    )
    repo.findById.mockResolvedValue(ok(incident))
    repo.addUpdate.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdMajorIncidentService.addUpdate('agent', WS, 'i1', input),
      'DATABASE_ERROR',
    )
    as('requester')
    expectErr(
      await SdMajorIncidentService.addUpdate('req', WS, 'i1', input),
      'SD_NOT_AGENT',
    )
  })
})

describe('SdMajorIncidentService.resolve', () => {
  const input = { message: 'Tudo normal', publish: true, resolution: 'Link' }

  it('resolves, notifies the team and enqueues the public notice', async () => {
    expectOk(await SdMajorIncidentService.resolve('agent', WS, 'i1', input))
    expect(repo.resolve).toHaveBeenCalledWith('i1', WS, {
      message: 'Tudo normal',
      publish: true,
      resolution: 'Link',
      resolvedById: 'agent',
    })
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'major_incident.resolved' }),
    )
    expect(enqueueSdStatusUpdateNotice).toHaveBeenCalledWith('u1')
    const events = vi.mocked(recordSdTicketEvent).mock.calls[0][0] as {
      action: string
    }[]
    expect(events[0].action).toBe('major_incident.resolved')
  })

  it('does not publish without pages and tolerates a missing master or notify error', async () => {
    repo.findById.mockResolvedValue(ok({ ...incident, pages: [] }))
    engine.resolveRef.mockResolvedValue(err(sdTicketNotFound()))
    expectOk(
      await SdMajorIncidentService.resolve('agent', WS, 'i1', {
        message: 'Tudo normal',
        publish: true,
      }),
    )
    expect(repo.resolve).toHaveBeenCalledWith(
      'i1',
      WS,
      expect.objectContaining({ publish: false, resolution: null }),
    )
    expect(notify).not.toHaveBeenCalled()
    expect(enqueueSdStatusUpdateNotice).not.toHaveBeenCalled()

    repo.findById.mockResolvedValue(ok(incident))
    engine.resolveRef.mockImplementation(async (_ws, ref) =>
      refs[ref] ? ok(refs[ref]) : err(sdTicketNotFound()),
    )
    notify.mockResolvedValueOnce(err(databaseError()))
    expectOk(await SdMajorIncidentService.resolve('agent', WS, 'i1', input))
  })

  it('refuses resolved incidents and propagates errors', async () => {
    repo.findById.mockResolvedValue(ok({ ...incident, status: 'RESOLVED' }))
    expectErr(
      await SdMajorIncidentService.resolve('agent', WS, 'i1', input),
      'SD_MAJOR_INCIDENT_RESOLVED',
    )
    repo.findById.mockResolvedValue(ok(incident))
    repo.resolve.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdMajorIncidentService.resolve('agent', WS, 'i1', input),
      'DATABASE_ERROR',
    )
    as('requester')
    expectErr(
      await SdMajorIncidentService.resolve('req', WS, 'i1', input),
      'SD_NOT_AGENT',
    )
  })
})

describe('SdMajorIncidentService.resolve with children', () => {
  const input = {
    message: 'Tudo normal',
    publish: false,
    resolution: 'Link trocado',
    childTicketIds: ['t2'],
  }
  const resolvedPhase = createFakeSdPhase({
    id: 'ph-res',
    category: 'RESOLVED',
  })

  beforeEach(() => {
    ctxRepo.findFirstPhaseByCategory.mockResolvedValue(ok(resolvedPhase))
    engine.changePhase.mockResolvedValue(ok(child))
  })

  it('resolves the confirmed children through the engine and reports each one', async () => {
    const out = expectOk(
      await SdMajorIncidentService.resolve('agent', WS, 'i1', input),
    )
    expect(out.childResults).toEqual([
      {
        ticketId: 't2',
        code: expect.stringContaining('8'),
        title: child.title,
        outcome: 'RESOLVED',
        reason: null,
      },
    ])
    expect(ctxRepo.findFirstPhaseByCategory).toHaveBeenCalledWith(
      WS,
      child.type,
      'RESOLVED',
    )
    const [ticket, phaseId, actor, , options] = engine.changePhase.mock.calls[0]
    expect(ticket).toBe(child)
    expect(phaseId).toBe('ph-res')
    expect(actor).toMatchObject({ kind: 'user', userId: 'agent' })
    expect(options).toMatchObject({
      reason: 'major_incident.bulk_resolve',
      solution: expect.stringContaining('Link trocado'),
    })
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'bulk_resolve',
        meta: expect.objectContaining({ requested: 1, resolved: 1, failed: 0 }),
      }),
    )
  })

  it('uses the public message when there is no internal resolution', async () => {
    expectOk(
      await SdMajorIncidentService.resolve('agent', WS, 'i1', {
        ...input,
        resolution: undefined,
      }),
    )
    expect(engine.changePhase.mock.calls[0][4]?.solution).toContain(
      'Tudo normal',
    )
  })

  it('touches no child unless asked', async () => {
    const out = expectOk(
      await SdMajorIncidentService.resolve('agent', WS, 'i1', {
        ...input,
        childTicketIds: undefined,
      }),
    )
    expect(out.childResults).toEqual([])
    expect(engine.changePhase).not.toHaveBeenCalled()
  })

  it('skips what is not a linked child, is unknown or already closed', async () => {
    refs.stranger = createFakeSdTicket({ id: 't9', number: 9 })
    const closed = createFakeSdTicket({
      id: 't2',
      number: 8,
      phase: { ...child.phase, category: 'CLOSED' },
    })
    engine.resolveRef.mockImplementation(async (_ws, ref) => {
      if (ref === 'closed') return ok(closed)
      return refs[ref] ? ok(refs[ref]) : err(sdTicketNotFound())
    })
    const out = expectOk(
      await SdMajorIncidentService.resolve('agent', WS, 'i1', {
        ...input,
        childTicketIds: ['stranger', 'nope', 'closed', 'nope'],
      }),
    )
    expect(out.childResults.map((r) => [r.ticketId, r.outcome])).toEqual([
      ['stranger', 'SKIPPED'],
      ['nope', 'SKIPPED'],
      ['t2', 'SKIPPED'],
    ])
    expect(out.childResults[0].reason).toBe('Não é filho deste incidente')
    expect(out.childResults[1].reason).toBe('Chamado não encontrado')
    expect(out.childResults[2].reason).toBe('O chamado já estava encerrado')
    expect(engine.changePhase).not.toHaveBeenCalled()
    delete refs.stranger
  })

  it('reports a failed child without stopping the others', async () => {
    ctxRepo.findFirstPhaseByCategory.mockResolvedValueOnce(ok(null))
    ctxRepo.findFirstPhaseByCategory.mockResolvedValueOnce(err(databaseError()))
    const out = expectOk(
      await SdMajorIncidentService.resolve('agent', WS, 'i1', {
        ...input,
        childTicketIds: ['t2', 'INC-000008', 'INC-000007'],
      }),
    )
    // 'INC-000007' is the master, which is not a child.
    expect(out.childResults.map((r) => r.outcome)).toEqual([
      'FAILED',
      'FAILED',
      'SKIPPED',
    ])
    expect(out.childResults[0].reason).toContain('fase de resolução')
    expect(out.childResults[1].reason).toContain('consultar as fases')
  })

  it('shows the reason when the engine refuses the phase', async () => {
    engine.changePhase.mockResolvedValue(
      err({ code: 'SD_PHASE_REQUIREMENTS_UNMET', message: 'Falta a solução' }),
    )
    const out = expectOk(
      await SdMajorIncidentService.resolve('agent', WS, 'i1', input),
    )
    expect(out.childResults[0]).toMatchObject({
      outcome: 'FAILED',
      reason: 'Falta a solução',
    })
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'bulk_resolve',
        meta: expect.objectContaining({ resolved: 0, failed: 1 }),
      }),
    )
  })
})

describe('SdMajorIncidentService.linkTickets', () => {
  it('links through the shared linker and reports the skipped ones', async () => {
    const out = expectOk(
      await SdMajorIncidentService.linkTickets('agent', WS, 'i1', {
        ticketRefs: ['8', 'nope', 'INC-000007'],
      }),
    )
    expect(out.linked).toBe(1)
    expect(out.skipped.map((s) => s.ref).sort()).toEqual(['INC-000007', 'nope'])
    expect(linker.attach).toHaveBeenCalledWith({
      workspaceId: WS,
      incidentId: 'i1',
      ticketId: 't2',
      source: 'MANUAL',
      actorId: 'agent',
    })
    expect(auditMutation).toHaveBeenCalled()
  })

  it('skips already linked tickets and attach failures, auditing only real links', async () => {
    repo.linkedTicketIds.mockResolvedValue(ok(['t2']))
    const already = expectOk(
      await SdMajorIncidentService.linkTickets('agent', WS, 'i1', {
        ticketRefs: ['8'],
      }),
    )
    expect(already).toEqual({
      linked: 0,
      skipped: [{ ref: '8', reason: 'Já vinculado' }],
    })
    expect(auditMutation).not.toHaveBeenCalled()

    repo.linkedTicketIds.mockResolvedValue(ok([]))
    linker.attach.mockResolvedValueOnce(ok({ linked: false }))
    expect(
      expectOk(
        await SdMajorIncidentService.linkTickets(
          'agent',
          WS,
          'i1',
          { ticketRefs: ['8'] },
          'SUGGESTION',
        ),
      ).linked,
    ).toBe(0)
    linker.attach.mockResolvedValueOnce(err(databaseError()))
    const failed = expectOk(
      await SdMajorIncidentService.linkTickets('agent', WS, 'i1', {
        ticketRefs: ['8'],
      }),
    )
    expect(failed.skipped).toHaveLength(1)
  })

  it('refuses resolved incidents and propagates errors', async () => {
    repo.findById.mockResolvedValue(ok({ ...incident, status: 'RESOLVED' }))
    expectErr(
      await SdMajorIncidentService.linkTickets('agent', WS, 'i1', {
        ticketRefs: ['8'],
      }),
      'SD_MAJOR_INCIDENT_RESOLVED',
    )
    repo.findById.mockResolvedValue(ok(incident))
    repo.linkedTicketIds.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdMajorIncidentService.linkTickets('agent', WS, 'i1', {
        ticketRefs: ['8'],
      }),
      'DATABASE_ERROR',
    )
    as('requester')
    expectErr(
      await SdMajorIncidentService.linkTickets('req', WS, 'i1', {
        ticketRefs: ['8'],
      }),
      'SD_NOT_AGENT',
    )
  })
})

describe('SdMajorIncidentService.unlinkTicket', () => {
  it('unlinks and records the history, once', async () => {
    expectOk(await SdMajorIncidentService.unlinkTicket('agent', WS, 'i1', 't2'))
    expect(recordSdTicketEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: 't2',
        action: 'major_incident.unlinked',
      }),
    )
    vi.mocked(recordSdTicketEvent).mockClear()
    repo.unlinkTicket.mockResolvedValue(ok(false))
    expectOk(await SdMajorIncidentService.unlinkTicket('agent', WS, 'i1', 't2'))
    expect(recordSdTicketEvent).not.toHaveBeenCalled()
  })

  it('refuses resolved incidents and propagates errors', async () => {
    repo.findById.mockResolvedValue(ok({ ...incident, status: 'RESOLVED' }))
    expectErr(
      await SdMajorIncidentService.unlinkTicket('agent', WS, 'i1', 't2'),
      'SD_MAJOR_INCIDENT_RESOLVED',
    )
    repo.findById.mockResolvedValue(ok(incident))
    repo.unlinkTicket.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdMajorIncidentService.unlinkTicket('agent', WS, 'i1', 't2'),
      'DATABASE_ERROR',
    )
    as('requester')
    expectErr(
      await SdMajorIncidentService.unlinkTicket('req', WS, 'i1', 't2'),
      'SD_NOT_AGENT',
    )
  })
})

describe('SdMajorIncidentService.suggestions', () => {
  it('explains why each ticket looks related', async () => {
    refs.t1 = createFakeSdTicket({
      id: 't1',
      categoryId: 'k1',
      configItemId: 'ci1',
      customerId: 'c1',
    })
    repo.findRelatedTickets.mockResolvedValue(
      ok([
        {
          id: 'x1',
          number: 20,
          title: 'Sem ramal',
          createdAt: new Date('2026-10-29T10:00:00.000Z'),
          categoryId: 'k1',
          configItemId: 'ci1',
          customerId: 'c1',
        },
        {
          id: 'x2',
          number: 21,
          title: 'Outro',
          createdAt: new Date('2026-10-29T10:00:00.000Z'),
          categoryId: 'zz',
          configItemId: null,
          customerId: 'c1',
        },
      ]),
    )
    const out = expectOk(
      await SdMajorIncidentService.suggestions('agent', WS, 'i1'),
    )
    refs.t1 = master
    expect(out.items[0]).toMatchObject({
      code: 'INC-000020',
      reasons: ['CATEGORY', 'CONFIG_ITEM', 'CUSTOMER'],
    })
    expect(out.items[1].reasons).toEqual(['CUSTOMER'])
    expect(repo.findRelatedTickets).toHaveBeenCalledWith(
      expect.objectContaining({
        excludeTicketIds: ['t1', 't2'],
        categoryId: 'k1',
        limit: 30,
      }),
    )
  })

  it('propagates errors and denies requesters', async () => {
    repo.findById.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdMajorIncidentService.suggestions('agent', WS, 'i1'),
      'DATABASE_ERROR',
    )
    repo.findById.mockResolvedValue(ok(incident))
    engine.resolveRef.mockResolvedValue(err(sdTicketNotFound()))
    expectErr(
      await SdMajorIncidentService.suggestions('agent', WS, 'i1'),
      'SD_TICKET_NOT_FOUND',
    )
    engine.resolveRef.mockImplementation(async (_ws, ref) =>
      refs[ref] ? ok(refs[ref]) : err(sdTicketNotFound()),
    )
    repo.findRelatedTickets.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdMajorIncidentService.suggestions('agent', WS, 'i1'),
      'DATABASE_ERROR',
    )
    as('requester')
    expectErr(
      await SdMajorIncidentService.suggestions('req', WS, 'i1'),
      'SD_NOT_AGENT',
    )
  })
})
