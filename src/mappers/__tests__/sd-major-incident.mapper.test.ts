import { describe, expect, it } from 'vitest'
import {
  createFakeSdMajorIncident,
  createFakeSdMajorIncidentSummary,
  createFakeSdStatusPage,
  createFakeSdStatusSubscriber,
} from '@/src/__tests__/factories/nov-s2-major-incident.factory'
import { DEFAULT_SD_TICKET_PREFIXES } from '@/src/lib/servicedesk/ticket-code'
import {
  sdMajorIncidentUserIds,
  toSdMajorIncidentDTO,
  toSdMajorIncidentSummaryDTO,
} from '../sd-major-incident.mapper'
import {
  maskStatusAddress,
  toSdPublicStatusPageDTO,
  toSdStatusPageDTO,
  toSdStatusSubscriberDTO,
} from '../sd-status-page.mapper'

const users = new Map([
  ['agent', { id: 'agent', name: 'Ana', email: 'a@x.com', image: null }],
])

describe('sd-major-incident mapper', () => {
  it('collects the user ids of full and summary rows', () => {
    const full = createFakeSdMajorIncident({ resolvedById: 'boss' })
    const summary = createFakeSdMajorIncidentSummary({ commanderId: null })
    const ids = sdMajorIncidentUserIds([full, summary])
    expect(ids).toContain('agent')
    expect(ids).toContain('boss')
  })

  it('maps the summary with the ticket code and counters', () => {
    const dto = toSdMajorIncidentSummaryDTO(
      createFakeSdMajorIncidentSummary(),
      users,
      DEFAULT_SD_TICKET_PREFIXES,
    )
    expect(dto.ticketCode).toBe('INC-000007')
    expect(dto.commander?.name).toBe('Ana')
    expect(dto.childCount).toBe(1)
    expect(dto.pageCount).toBe(1)
    expect(dto.resolvedAt).toBeNull()
  })

  it('maps the full incident newest-first with children and pages', () => {
    const row = createFakeSdMajorIncident({
      resolvedAt: new Date('2026-10-30T00:00:00.000Z'),
      status: 'RESOLVED',
      commanderId: null,
    })
    row.updates.push({
      ...row.updates[0],
      id: 'u2',
      status: 'RESOLVED',
      notifiedAt: new Date('2026-10-30T00:00:00.000Z'),
      notifyTotal: 3,
      notifySent: 2,
      notifyFailed: 1,
    })
    const dto = toSdMajorIncidentDTO(row, users, DEFAULT_SD_TICKET_PREFIXES)
    expect(dto.updates.map((u) => u.id)).toEqual(['u2', 'u1'])
    expect(dto.updates[0].notify).toEqual({
      done: true,
      total: 3,
      sent: 2,
      failed: 1,
    })
    expect(dto.updates[1].author?.id).toBe('agent')
    expect(dto.children[0]).toMatchObject({
      code: 'INC-000008',
      phase: 'Em andamento',
      phaseCategory: 'IN_PROGRESS',
      source: 'MANUAL',
    })
    expect(dto.pages).toEqual([{ id: 'p1', name: 'Acme', slug: 'acme-abc123' }])
    expect(dto.commander).toBeNull()
    expect(dto.resolvedAt).toBe('2026-10-30T00:00:00.000Z')
    expect(dto.ticketTitle).toBe('Link fora')
  })
})

describe('sd-status-page mapper', () => {
  it('maps the page with names, counters and the path', () => {
    const dto = toSdStatusPageDTO(
      createFakeSdStatusPage({ customerId: 'c1', serviceIds: ['s1', 's2'] }),
      {
        services: new Map([['s1', 'Telefonia']]),
        customers: new Map([['c1', 'Acme']]),
        subscribers: 4,
        active: 1,
      },
    )
    expect(dto.path).toBe('/status-page/acme-abc123')
    expect(dto.customer).toEqual({ id: 'c1', name: 'Acme' })
    expect(dto.services).toEqual([{ id: 's1', name: 'Telefonia' }])
    expect(dto.subscriberCount).toBe(4)
    expect(dto.activeIncidentCount).toBe(1)
  })

  it('names a removed customer and handles pages without scope', () => {
    const removed = toSdStatusPageDTO(
      createFakeSdStatusPage({ customerId: 'gone' }),
      {
        services: new Map(),
        customers: new Map(),
        subscribers: 0,
        active: 0,
      },
    )
    expect(removed.customer?.name).toBe('Cliente removido')
    const open = toSdStatusPageDTO(createFakeSdStatusPage(), {
      services: new Map(),
      customers: new Map(),
      subscribers: 0,
      active: 0,
    })
    expect(open.customer).toBeNull()
  })

  it('maps subscribers and masks addresses', () => {
    expect(
      toSdStatusSubscriberDTO(createFakeSdStatusSubscriber()).confirmed,
    ).toBe(true)
    expect(
      toSdStatusSubscriberDTO(
        createFakeSdStatusSubscriber({ confirmedAt: null }),
      ).confirmed,
    ).toBe(false)
    expect(maskStatusAddress('EMAIL', 'joao@acme.com.br')).toBe(
      'j***@acme.com.br',
    )
    expect(maskStatusAddress('WHATSAPP', '5511999990000')).toBe('***0000')
  })

  it('builds the public page with the worst active impact', () => {
    const incident = (
      id: string,
      status: 'INVESTIGATING' | 'RESOLVED',
      impact: 'DEGRADED' | 'MAJOR_OUTAGE',
    ) => ({
      id,
      title: id,
      summary: null,
      impact,
      status,
      declaredAt: new Date('2026-10-29T10:00:00.000Z'),
      resolvedAt:
        status === 'RESOLVED' ? new Date('2026-10-29T11:00:00.000Z') : null,
      updates: [
        {
          status,
          message: 'msg',
          createdAt: new Date('2026-10-29T10:30:00.000Z'),
        },
      ],
    })
    const dto = toSdPublicStatusPageDTO({
      page: createFakeSdStatusPage({ description: 'Desc' }),
      workspaceName: 'Stratus',
      services: ['Telefonia'],
      incidents: [
        incident('a', 'INVESTIGATING', 'DEGRADED'),
        incident('b', 'INVESTIGATING', 'MAJOR_OUTAGE'),
        incident('c', 'RESOLVED', 'MAJOR_OUTAGE'),
      ],
    })
    expect(dto.overall).toBe('MAJOR_OUTAGE')
    expect(dto.active.map((i) => i.id)).toEqual(['a', 'b'])
    expect(dto.recent.map((i) => i.id)).toEqual(['c'])
    expect(dto.recent[0].resolvedAt).toBe('2026-10-29T11:00:00.000Z')
    expect(dto.timeZone).toBe('America/Sao_Paulo')
    expect(dto.workspaceName).toBe('Stratus')

    const quiet = toSdPublicStatusPageDTO({
      page: createFakeSdStatusPage(),
      workspaceName: '',
      services: [],
      incidents: [],
    })
    expect(quiet.overall).toBe('OPERATIONAL')
  })
})
