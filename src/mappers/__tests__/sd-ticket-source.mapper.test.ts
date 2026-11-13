import { describe, expect, it } from 'vitest'
import { toSdTicketSourceLinkDTO } from '../sd-ticket-source.mapper'

const context = {
  prefixes: {
    INCIDENT: 'INC',
    SERVICE_REQUEST: 'REQ',
    CHANGE: 'CHG',
    PROBLEM: 'PRB',
  },
  slug: 'acme',
}

const row = (category: string) =>
  ({
    id: 'tk1',
    number: 7,
    type: 'INCIDENT',
    title: 'Sem acesso',
    createdAt: new Date('2026-11-13T17:05:00.000Z'),
    phase: { name: 'Fase', category },
  }) as never

describe('toSdTicketSourceLinkDTO', () => {
  it('builds the code, the path and the ISO date', () => {
    expect(toSdTicketSourceLinkDTO(row('NEW'), context)).toEqual({
      id: 'tk1',
      number: 7,
      code: 'INC-000007',
      title: 'Sem acesso',
      type: 'INCIDENT',
      phaseName: 'Fase',
      phaseCategory: 'NEW',
      open: true,
      createdAt: '2026-11-13T17:05:00.000Z',
      href: '/acme/servicedesk/tickets/7',
    })
  })

  it('marks resolved, closed and canceled tickets as not open', () => {
    for (const category of ['RESOLVED', 'CLOSED', 'CANCELED']) {
      expect(toSdTicketSourceLinkDTO(row(category), context).open).toBe(false)
    }
  })
})
