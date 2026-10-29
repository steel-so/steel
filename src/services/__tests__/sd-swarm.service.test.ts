import type { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeSdSwarm } from '@/src/__tests__/factories/nov-s6-swarming.factory'
import { createFakeSdTicket } from '@/src/__tests__/factories/sd-ticket.factory'
import { createFakeSdSettings } from '@/src/__tests__/factories/sd-ticket-context.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import { DEFAULT_SD_TICKET_PREFIXES } from '@/src/lib/servicedesk/ticket-code'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/sd-access.repository')
vi.mock('@/src/repositories/sd-swarm.repository')
vi.mock('@/src/repositories/sd-ticket.repository')
vi.mock('@/src/repositories/sd-ticket-context.repository')
vi.mock('@/src/repositories/sd-ticket-participant.repository')
vi.mock('@/src/lib/servicedesk/realtime', () => ({
  publishSdTicketEvent: vi.fn(),
}))
vi.mock('@/src/lib/search/index-hooks', () => ({
  indexSearchDocument: vi.fn(),
}))
vi.mock('@/lib/axiom/audit')
vi.mock('../sd-ticket-event-recorder', () => ({
  recordSdTicketEvent: vi.fn(),
  sdEventActorKind: (a: { isAgent?: boolean }) =>
    a.isAgent ? 'AGENT' : 'REQUESTER',
}))
vi.mock('../sd-notification.service', () => ({
  notifySdEvent: vi.fn(async () => ({ ok: true, value: {} })),
}))
vi.mock('../sd-swarm-slack', () => ({
  SdSwarmSlack: {
    available: vi.fn(),
    open: vi.fn(),
    invite: vi.fn(),
    close: vi.fn(),
  },
}))
vi.mock('../sd-ticket-engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sd-ticket-engine')>()),
  SdTicketEngine: { loadConfig: vi.fn(), resolveRef: vi.fn() },
}))

import { auditMutation } from '@/lib/axiom/audit'
import { publishSdTicketEvent } from '@/src/lib/servicedesk/realtime'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { SdAccessRepository } from '@/src/repositories/sd-access.repository'
import { SdSwarmRepository } from '@/src/repositories/sd-swarm.repository'
import { SdTicketRepository } from '@/src/repositories/sd-ticket.repository'
import { SdTicketContextRepository } from '@/src/repositories/sd-ticket-context.repository'
import { SdTicketParticipantRepository } from '@/src/repositories/sd-ticket-participant.repository'
import { notifySdEvent } from '../sd-notification.service'
import { SdSwarmService } from '../sd-swarm.service'
import { SdSwarmSlack } from '../sd-swarm-slack'
import { SdTicketEngine } from '../sd-ticket-engine'
import { recordSdTicketEvent } from '../sd-ticket-event-recorder'

const config = {
  settings: createFakeSdSettings(),
  prefixes: DEFAULT_SD_TICKET_PREFIXES,
}
const swarmRepo = vi.mocked(SdSwarmRepository)
const ctxRepo = vi.mocked(SdTicketContextRepository)
const partRepo = vi.mocked(SdTicketParticipantRepository)
const ticketRepo = vi.mocked(SdTicketRepository)
const engine = vi.mocked(SdTicketEngine)
const slack = vi.mocked(SdSwarmSlack)
const notify = vi.mocked(notifySdEvent)

const WS = 'ws1'
const ticket = createFakeSdTicket({ id: 't1', number: 7, requesterId: 'req' })
const open = createFakeSdSwarm({ id: 's1', ticketId: 't1' })

function as(who: 'agent' | 'specialist' | 'requester', role: Role = 'MEMBER') {
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

beforeEach(() => {
  vi.clearAllMocks()
  as('agent')
  engine.loadConfig.mockResolvedValue(ok(config))
  engine.resolveRef.mockResolvedValue(ok(ticket))
  ticketRepo.findById.mockResolvedValue(ok(ticket))
  ctxRepo.findNonMembers.mockResolvedValue(ok([]))
  ctxRepo.findWorkspace.mockResolvedValue(
    ok({ id: WS, name: 'Demo', slug: 'demo' }),
  )
  partRepo.add.mockResolvedValue(ok(true))
  swarmRepo.findOpenByTicket.mockResolvedValue(ok(null))
  swarmRepo.findById.mockResolvedValue(ok(open))
  swarmRepo.create.mockResolvedValue(ok(open))
  swarmRepo.setSlack.mockResolvedValue(ok(true))
  swarmRepo.invite.mockResolvedValue(ok(['s2']))
  swarmRepo.respond.mockResolvedValue(ok(true))
  swarmRepo.close.mockResolvedValue(ok(true))
  swarmRepo.listByTicket.mockResolvedValue(ok([open]))
  swarmRepo.isMemberOfTicket.mockResolvedValue(ok(true))
  slack.available.mockResolvedValue(true)
  slack.open.mockResolvedValue(
    ok({ channelId: 'C1', channelName: 'swarm-inc-7' }),
  )
  slack.invite.mockResolvedValue(ok(1))
  slack.close.mockResolvedValue(true)
})

describe('SdSwarmService.list', () => {
  it('lists for agents with the Slack availability', async () => {
    const out = expectOk(await SdSwarmService.list('agent', WS, 't1'))
    expect(out.items).toHaveLength(1)
    expect(out.slackAvailable).toBe(true)
    expect(out.maxMembers).toBe(10)
    expect(swarmRepo.isMemberOfTicket).not.toHaveBeenCalled()
  })

  it('lets an invited non-agent in, and blocks the others', async () => {
    as('specialist')
    ticketRepo.findById.mockResolvedValue(ok(ticket))
    engine.resolveRef.mockResolvedValue(
      ok(
        createFakeSdTicket({
          id: 't1',
          requesterId: 'req',
          participants: [
            {
              userId: 'sp',
              user: { id: 'sp', name: 'Sp', email: 'sp@x', image: null },
            },
          ],
        }),
      ),
    )
    expectOk(await SdSwarmService.list('sp', WS, 't1'))
    swarmRepo.isMemberOfTicket.mockResolvedValue(ok(false))
    expectErr(await SdSwarmService.list('sp', WS, 't1'), 'SD_NOT_AGENT')
    swarmRepo.isMemberOfTicket.mockResolvedValue(err(databaseError()))
    expectErr(await SdSwarmService.list('sp', WS, 't1'), 'DATABASE_ERROR')
  })

  it('denies a requester without a link to the ticket', async () => {
    as('requester')
    expectErr(
      await SdSwarmService.list('stranger', WS, 't1'),
      'SD_TICKET_FORBIDDEN',
    )
  })

  it('propagates repository errors', async () => {
    swarmRepo.listByTicket.mockResolvedValue(err(databaseError()))
    expectErr(await SdSwarmService.list('agent', WS, 't1'), 'DATABASE_ERROR')
  })
})

describe('SdSwarmService.start', () => {
  const input = { reason: 'Rede caiu', userIds: ['s1', 'agent', 's1'] }

  it('opens the swarm, adds participants, notifies and audits', async () => {
    const out = expectOk(
      await SdSwarmService.start('agent', WS, 't1', {
        ...input,
        openSlackChannel: false,
      }),
    )
    expect(out.id).toBe('s1')
    expect(swarmRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ memberIds: ['s1'], startedById: 'agent' }),
    )
    expect(partRepo.add).toHaveBeenCalledWith('t1', 's1', 'agent')
    expect(slack.open).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'swarm.invited',
        payload: expect.objectContaining({ userIds: ['s1'] }),
      }),
    )
    expect(recordSdTicketEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'swarm.started' }),
    )
    expect(publishSdTicketEvent).toHaveBeenCalled()
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'sd_swarm', action: 'create' }),
    )
  })

  it('opens and stores the Slack channel when asked', async () => {
    expectOk(
      await SdSwarmService.start('agent', WS, 't1', {
        ...input,
        openSlackChannel: true,
      }),
    )
    expect(slack.open).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketCode: expect.any(String),
        ticketUrl: expect.stringContaining('/demo/servicedesk/tickets/7'),
        emails: expect.arrayContaining(['s1@example.com', 'agent@example.com']),
      }),
    )
    expect(swarmRepo.setSlack).toHaveBeenCalledWith('s1', {
      slackChannelId: 'C1',
      slackChannelName: 'swarm-inc-7',
      slackError: null,
    })
  })

  it('keeps the swarm when Slack fails and records why', async () => {
    slack.open.mockResolvedValue(
      err({
        code: 'SD_INTEGRATION_NOT_CONFIGURED',
        message: 'Sem Slack',
      } as never),
    )
    swarmRepo.setSlack.mockResolvedValue(err(databaseError()))
    expectOk(
      await SdSwarmService.start('agent', WS, 't1', {
        ...input,
        openSlackChannel: true,
      }),
    )
    expect(swarmRepo.setSlack).toHaveBeenCalledWith('s1', {
      slackChannelId: null,
      slackChannelName: null,
      slackError: 'Sem Slack',
    })
  })

  it('falls back to the base URL when the workspace is unknown', async () => {
    ctxRepo.findWorkspace.mockResolvedValue(err(databaseError()))
    expectOk(
      await SdSwarmService.start('agent', WS, 't1', {
        ...input,
        openSlackChannel: true,
      }),
    )
    expect(slack.open.mock.calls[0][0].ticketUrl).not.toContain('/servicedesk/')
  })

  it('denies non-agents and rejects closed tickets', async () => {
    as('requester')
    engine.resolveRef.mockResolvedValue(
      ok(createFakeSdTicket({ id: 't1', requesterId: 'req' })),
    )
    expectErr(
      await SdSwarmService.start('req', WS, 't1', {
        ...input,
        openSlackChannel: false,
      }),
      'SD_NOT_AGENT',
    )
    as('agent')
    engine.resolveRef.mockResolvedValue(
      ok(
        createFakeSdTicket({
          id: 't1',
          phase: { ...ticket.phase, category: 'CLOSED' },
        }),
      ),
    )
    expectErr(
      await SdSwarmService.start('agent', WS, 't1', {
        ...input,
        openSlackChannel: false,
      }),
      'SD_TICKET_CLOSED',
    )
  })

  it('refuses a second open swarm, self-only and outsiders', async () => {
    const base = { ...input, openSlackChannel: false }
    swarmRepo.findOpenByTicket.mockResolvedValue(ok(open))
    expectErr(
      await SdSwarmService.start('agent', WS, 't1', base),
      'SD_SWARM_ALREADY_OPEN',
    )
    swarmRepo.findOpenByTicket.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdSwarmService.start('agent', WS, 't1', base),
      'DATABASE_ERROR',
    )
    swarmRepo.findOpenByTicket.mockResolvedValue(ok(null))
    expectErr(
      await SdSwarmService.start('agent', WS, 't1', {
        reason: 'Rede caiu',
        userIds: ['agent'],
        openSlackChannel: false,
      }),
      'VALIDATION_ERROR',
    )
    ctxRepo.findNonMembers.mockResolvedValue(ok(['s1']))
    expectErr(
      await SdSwarmService.start('agent', WS, 't1', base),
      'VALIDATION_ERROR',
    )
    ctxRepo.findNonMembers.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdSwarmService.start('agent', WS, 't1', base),
      'DATABASE_ERROR',
    )
    ctxRepo.findNonMembers.mockResolvedValue(ok([]))
    swarmRepo.create.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdSwarmService.start('agent', WS, 't1', base),
      'DATABASE_ERROR',
    )
  })

  it('survives participant, notification and refresh failures', async () => {
    partRepo.add.mockResolvedValue(err(databaseError()))
    notify.mockResolvedValueOnce(err(databaseError()))
    ticketRepo.findById.mockResolvedValue(err(databaseError()))
    expectOk(
      await SdSwarmService.start('agent', WS, 't1', {
        ...input,
        openSlackChannel: false,
      }),
    )
  })

  it('has no creator in the Slack invite list when the user is gone', async () => {
    swarmRepo.create.mockResolvedValue(
      ok(createFakeSdSwarm({ id: 's1', startedBy: null })),
    )
    expectOk(
      await SdSwarmService.start('agent', WS, 't1', {
        ...input,
        openSlackChannel: true,
      }),
    )
    expect(slack.open.mock.calls[0][0].emails).toEqual(['s1@example.com'])
  })
})

describe('SdSwarmService.invite', () => {
  it('invites, adds to Slack and records', async () => {
    swarmRepo.findById.mockResolvedValue(
      ok(
        createFakeSdSwarm({
          id: 's1',
          slackChannelId: 'C1',
          members: [
            ...open.members,
            {
              ...open.members[0],
              userId: 's2',
              user: { id: 's2', name: 'Sue', email: 's2@x', image: null },
            },
          ],
        }),
      ),
    )
    const out = expectOk(
      await SdSwarmService.invite('agent', WS, 't1', 's1', { userIds: ['s2'] }),
    )
    expect(out.id).toBe('s1')
    expect(slack.invite).toHaveBeenCalledWith(WS, 'C1', ['s2@x'])
    expect(recordSdTicketEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'swarm.invited' }),
    )
    expect(auditMutation).toHaveBeenCalled()
  })

  it('tolerates a Slack invite failure and skips Slack without a channel', async () => {
    swarmRepo.findById.mockResolvedValue(
      ok(createFakeSdSwarm({ id: 's1', slackChannelId: 'C1' })),
    )
    slack.invite.mockResolvedValue(err(databaseError()))
    expectOk(
      await SdSwarmService.invite('agent', WS, 't1', 's1', { userIds: ['s2'] }),
    )
    swarmRepo.findById.mockResolvedValue(ok(open))
    slack.invite.mockClear()
    expectOk(
      await SdSwarmService.invite('agent', WS, 't1', 's1', { userIds: ['s2'] }),
    )
    expect(slack.invite).not.toHaveBeenCalled()
  })

  it('does nothing else when nobody new was invited', async () => {
    swarmRepo.invite.mockResolvedValue(ok([]))
    expectOk(
      await SdSwarmService.invite('agent', WS, 't1', 's1', { userIds: ['s1'] }),
    )
    expect(recordSdTicketEvent).not.toHaveBeenCalled()
  })

  it('does not call Slack for an archived channel', async () => {
    swarmRepo.findById.mockResolvedValue(
      ok(
        createFakeSdSwarm({
          id: 's1',
          slackChannelId: 'C1',
          slackArchivedAt: new Date(),
        }),
      ),
    )
    expectOk(
      await SdSwarmService.invite('agent', WS, 't1', 's1', { userIds: ['s2'] }),
    )
    expect(slack.invite).not.toHaveBeenCalled()
  })

  it('enforces the member limit, closed swarms, authz and errors', async () => {
    const full = createFakeSdSwarm({
      id: 's1',
      members: Array.from({ length: 10 }, (_, i) => ({
        ...open.members[0],
        userId: `m${i}`,
        user: { id: `m${i}`, name: 'M', email: `m${i}@x`, image: null },
      })),
    })
    swarmRepo.findById.mockResolvedValue(ok(full))
    expectErr(
      await SdSwarmService.invite('agent', WS, 't1', 's1', {
        userIds: ['new'],
      }),
      'SD_SWARM_LIMIT_REACHED',
    )
    // re-inviting someone already inside does not count against the limit
    expectOk(
      await SdSwarmService.invite('agent', WS, 't1', 's1', { userIds: ['m1'] }),
    )

    swarmRepo.findById.mockResolvedValue(
      ok(createFakeSdSwarm({ status: 'CLOSED' })),
    )
    expectErr(
      await SdSwarmService.invite('agent', WS, 't1', 's1', { userIds: ['x'] }),
      'SD_SWARM_CLOSED',
    )
    swarmRepo.findById.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdSwarmService.invite('agent', WS, 't1', 's1', { userIds: ['x'] }),
      'DATABASE_ERROR',
    )
    swarmRepo.findById.mockResolvedValue(ok(open))
    ctxRepo.findNonMembers.mockResolvedValue(ok(['x']))
    expectErr(
      await SdSwarmService.invite('agent', WS, 't1', 's1', { userIds: ['x'] }),
      'VALIDATION_ERROR',
    )
    ctxRepo.findNonMembers.mockResolvedValue(ok([]))
    swarmRepo.invite.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdSwarmService.invite('agent', WS, 't1', 's1', { userIds: ['x'] }),
      'DATABASE_ERROR',
    )
    as('requester')
    expectErr(
      await SdSwarmService.invite('req', WS, 't1', 's1', { userIds: ['x'] }),
      'SD_NOT_AGENT',
    )
  })
})

describe('SdSwarmService.respond', () => {
  const sw = createFakeSdSwarm({ id: 's1', startedById: 'agent' })

  it('joins, records and tells the starter', async () => {
    swarmRepo.findById.mockResolvedValue(ok(sw))
    expectOk(
      await SdSwarmService.respond('s1', WS, 't1', 's1', { response: 'JOIN' }),
    )
    expect(swarmRepo.respond).toHaveBeenCalledWith('s1', 's1', 'JOINED')
    expect(recordSdTicketEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'swarm.joined' }),
    )
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'swarm.responded',
        payload: expect.objectContaining({ userIds: ['agent'] }),
      }),
    )
  })

  it('declines and works without a starter or with notify failing', async () => {
    swarmRepo.findById.mockResolvedValue(ok(sw))
    notify.mockResolvedValueOnce(err(databaseError()))
    expectOk(
      await SdSwarmService.respond('s1', WS, 't1', 's1', {
        response: 'DECLINE',
      }),
    )
    expect(swarmRepo.respond).toHaveBeenCalledWith('s1', 's1', 'DECLINED')
    expect(recordSdTicketEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'swarm.declined' }),
    )
    swarmRepo.findById.mockResolvedValue(ok({ ...sw, startedById: null }))
    notify.mockClear()
    expectOk(
      await SdSwarmService.respond('s1', WS, 't1', 's1', { response: 'JOIN' }),
    )
    expect(notify).not.toHaveBeenCalled()
  })

  it('refuses outsiders, closed swarms and database errors', async () => {
    swarmRepo.findById.mockResolvedValue(ok(sw))
    expectErr(
      await SdSwarmService.respond('stranger', WS, 't1', 's1', {
        response: 'JOIN',
      }),
      'SD_SWARM_NOT_INVITED',
    )
    swarmRepo.findById.mockResolvedValue(ok({ ...sw, status: 'CLOSED' }))
    expectErr(
      await SdSwarmService.respond('s1', WS, 't1', 's1', { response: 'JOIN' }),
      'SD_SWARM_CLOSED',
    )
    swarmRepo.findById.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdSwarmService.respond('s1', WS, 't1', 's1', { response: 'JOIN' }),
      'DATABASE_ERROR',
    )
    swarmRepo.findById.mockResolvedValue(ok(sw))
    swarmRepo.respond.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdSwarmService.respond('s1', WS, 't1', 's1', { response: 'JOIN' }),
      'DATABASE_ERROR',
    )
  })
})

describe('SdSwarmService.close', () => {
  it('archives the Slack channel and stores the outcome', async () => {
    swarmRepo.findById.mockResolvedValue(
      ok(createFakeSdSwarm({ id: 's1', slackChannelId: 'C1' })),
    )
    expectOk(
      await SdSwarmService.close('agent', WS, 't1', 's1', {
        outcome: '  Trocado  ',
      }),
    )
    expect(slack.close).toHaveBeenCalledWith(WS, 'C1', 'Trocado')
    expect(swarmRepo.close).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({
        closedById: 'agent',
        outcome: 'Trocado',
        slackArchivedAt: expect.any(Date),
      }),
    )
    expect(recordSdTicketEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'swarm.closed' }),
    )
  })

  it('closes without Slack or outcome, and keeps the date null when archive fails', async () => {
    expectOk(await SdSwarmService.close('agent', WS, 't1', 's1', {}))
    expect(slack.close).not.toHaveBeenCalled()
    expect(swarmRepo.close).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ outcome: null, slackArchivedAt: null }),
    )
    swarmRepo.findById.mockResolvedValue(
      ok(createFakeSdSwarm({ id: 's1', slackChannelId: 'C1' })),
    )
    slack.close.mockResolvedValue(false)
    expectOk(
      await SdSwarmService.close('agent', WS, 't1', 's1', { outcome: '   ' }),
    )
    expect(swarmRepo.close).toHaveBeenLastCalledWith(
      's1',
      expect.objectContaining({ outcome: null, slackArchivedAt: null }),
    )
  })

  it('does not archive twice and refuses closed swarms, non-agents and errors', async () => {
    swarmRepo.findById.mockResolvedValue(
      ok(
        createFakeSdSwarm({
          id: 's1',
          slackChannelId: 'C1',
          slackArchivedAt: new Date(),
        }),
      ),
    )
    expectOk(await SdSwarmService.close('agent', WS, 't1', 's1', {}))
    expect(slack.close).not.toHaveBeenCalled()

    swarmRepo.findById.mockResolvedValue(
      ok(createFakeSdSwarm({ status: 'CLOSED' })),
    )
    expectErr(
      await SdSwarmService.close('agent', WS, 't1', 's1', {}),
      'SD_SWARM_CLOSED',
    )
    swarmRepo.findById.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdSwarmService.close('agent', WS, 't1', 's1', {}),
      'DATABASE_ERROR',
    )
    swarmRepo.findById.mockResolvedValue(ok(open))
    swarmRepo.close.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdSwarmService.close('agent', WS, 't1', 's1', {}),
      'DATABASE_ERROR',
    )
    as('requester')
    expectErr(
      await SdSwarmService.close('req', WS, 't1', 's1', {}),
      'SD_NOT_AGENT',
    )
  })
})
