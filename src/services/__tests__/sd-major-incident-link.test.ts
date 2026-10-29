import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSdMajorIncident } from '@/src/__tests__/factories/nov-s2-major-incident.factory'
import { createFakeSdTicket } from '@/src/__tests__/factories/sd-ticket.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/sd-major-incident.repository')
vi.mock('@/src/repositories/sd-ticket.repository')
vi.mock('../sd-ticket-event-recorder', () => ({ recordSdTicketEvent: vi.fn() }))

import { SdMajorIncidentRepository } from '@/src/repositories/sd-major-incident.repository'
import { SdTicketRepository } from '@/src/repositories/sd-ticket.repository'
import { SdMajorIncidentLinker } from '../sd-major-incident-link'
import { recordSdTicketEvent } from '../sd-ticket-event-recorder'

const repo = vi.mocked(SdMajorIncidentRepository)
const input = {
  workspaceId: 'ws1',
  incidentId: 'i1',
  ticketId: 't2',
  source: 'MONITORING' as const,
  actorId: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  repo.findById.mockResolvedValue(ok(createFakeSdMajorIncident({ id: 'i1' })))
  repo.linkTickets.mockResolvedValue(ok(1))
  vi.mocked(SdTicketRepository).findById.mockResolvedValue(
    ok(createFakeSdTicket({ id: 't2' })),
  )
})

describe('SdMajorIncidentLinker.attach', () => {
  it('links automation tickets as SYSTEM and records the history', async () => {
    expect(expectOk(await SdMajorIncidentLinker.attach(input))).toEqual({
      linked: true,
    })
    expect(repo.linkTickets).toHaveBeenCalledWith(
      'i1',
      'ws1',
      [{ ticketId: 't2', source: 'MONITORING' }],
      null,
    )
    expect(recordSdTicketEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorKind: 'SYSTEM',
        action: 'major_incident.linked',
      }),
    )
    await SdMajorIncidentLinker.attach({ ...input, actorId: 'agent' })
    expect(recordSdTicketEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ actorKind: 'AGENT', actorUserId: 'agent' }),
    )
  })

  it('reports an already linked ticket without a history entry', async () => {
    repo.linkTickets.mockResolvedValue(ok(0))
    expect(expectOk(await SdMajorIncidentLinker.attach(input)).linked).toBe(
      false,
    )
    expect(recordSdTicketEvent).not.toHaveBeenCalled()
  })

  it('refuses resolved incidents, the master and unknown tickets', async () => {
    repo.findById.mockResolvedValue(
      ok(createFakeSdMajorIncident({ status: 'RESOLVED' })),
    )
    expectErr(
      await SdMajorIncidentLinker.attach(input),
      'SD_MAJOR_INCIDENT_RESOLVED',
    )
    repo.findById.mockResolvedValue(
      ok(createFakeSdMajorIncident({ ticketId: 't2' })),
    )
    expectErr(
      await SdMajorIncidentLinker.attach(input),
      'SD_MAJOR_INCIDENT_INVALID_TICKET',
    )
    repo.findById.mockResolvedValue(err(databaseError()))
    expectErr(await SdMajorIncidentLinker.attach(input), 'DATABASE_ERROR')
    repo.findById.mockResolvedValue(ok(createFakeSdMajorIncident()))
    vi.mocked(SdTicketRepository).findById.mockResolvedValue(
      err(databaseError()),
    )
    expectErr(await SdMajorIncidentLinker.attach(input), 'DATABASE_ERROR')
    vi.mocked(SdTicketRepository).findById.mockResolvedValue(
      ok(createFakeSdTicket({ id: 't2' })),
    )
    repo.linkTickets.mockResolvedValue(err(databaseError()))
    expectErr(await SdMajorIncidentLinker.attach(input), 'DATABASE_ERROR')
  })
})

describe('SdMajorIncidentLinker.findActiveFor', () => {
  it('delegates the match to the repository', async () => {
    repo.findActiveByTicketMatch.mockResolvedValue(
      ok({ id: 'i1', title: 'x', ticketId: 't1' }),
    )
    const out = expectOk(
      await SdMajorIncidentLinker.findActiveFor('ws1', { configItemId: 'ci' }),
    )
    expect(out?.id).toBe('i1')
    expect(repo.findActiveByTicketMatch).toHaveBeenCalledWith('ws1', {
      configItemId: 'ci',
    })
  })
})
