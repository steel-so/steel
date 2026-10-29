import { createId } from '@paralleldrive/cuid2'
import { prisma } from '@/src/lib/prisma'
import type {
  SdMajorIncidentRow,
  SdMajorIncidentSummaryRow,
} from '@/src/repositories/sd-major-incident.repository'
import type {
  SdStatusPageRow,
  SdStatusSubscriberRow,
} from '@/src/repositories/sd-status-page.repository'

const fixed = () => new Date('2026-10-29T12:00:00.000Z')

/** Major incident with the relations of the repository include (unit tests). */
export function createFakeSdMajorIncident(
  overrides?: Partial<SdMajorIncidentRow>,
): SdMajorIncidentRow {
  const id = overrides?.id ?? createId()
  return {
    id,
    workspaceId: 'ws1',
    ticketId: 't1',
    title: 'Instabilidade na telefonia',
    summary: null,
    impact: 'PARTIAL_OUTAGE',
    status: 'INVESTIGATING',
    commanderId: 'agent',
    swarmId: null,
    declaredById: 'agent',
    resolvedById: null,
    resolution: null,
    declaredAt: fixed(),
    resolvedAt: null,
    updatedAt: fixed(),
    ticket: { id: 't1', number: 7, type: 'INCIDENT', title: 'Link fora' },
    updates: [
      {
        id: 'u1',
        incidentId: id,
        workspaceId: 'ws1',
        status: 'INVESTIGATING',
        message: 'Estamos investigando.',
        publish: true,
        authorId: 'agent',
        createdAt: fixed(),
        notifiedAt: null,
        notifyTotal: 0,
        notifySent: 0,
        notifyFailed: 0,
      },
    ],
    links: [
      {
        incidentId: id,
        ticketId: 't2',
        workspaceId: 'ws1',
        source: 'MANUAL',
        linkedById: 'agent',
        linkedAt: fixed(),
        ticket: {
          id: 't2',
          number: 8,
          type: 'INCIDENT',
          title: 'Sem ramal',
          phase: { name: 'Em andamento', category: 'IN_PROGRESS' },
        },
      },
    ],
    pages: [
      {
        incidentId: id,
        pageId: 'p1',
        workspaceId: 'ws1',
        page: { id: 'p1', name: 'Acme', slug: 'acme-abc123' },
      },
    ],
    ...overrides,
  }
}

export function createFakeSdMajorIncidentSummary(
  overrides?: Partial<SdMajorIncidentSummaryRow>,
): SdMajorIncidentSummaryRow {
  const full = createFakeSdMajorIncident()
  const { updates: _u, links: _l, pages: _p, ...base } = full
  return {
    ...base,
    _count: { links: 1, pages: 1 },
    ...overrides,
  }
}

export function createFakeSdStatusPage(
  overrides?: Partial<SdStatusPageRow>,
): SdStatusPageRow {
  return {
    id: 'p1',
    workspaceId: 'ws1',
    name: 'Acme',
    slug: 'acme-abc123',
    description: null,
    customerId: null,
    serviceIds: [],
    published: true,
    allowSubscriptions: true,
    timeZone: 'America/Sao_Paulo',
    createdById: 'agent',
    createdAt: fixed(),
    updatedAt: fixed(),
    ...overrides,
  }
}

export function createFakeSdStatusSubscriber(
  overrides?: Partial<SdStatusSubscriberRow>,
): SdStatusSubscriberRow {
  return {
    id: 'sub1',
    workspaceId: 'ws1',
    pageId: 'p1',
    channel: 'EMAIL',
    address: 'ana@acme.com.br',
    name: null,
    token: createId(),
    confirmedAt: fixed(),
    addedById: null,
    createdAt: fixed(),
    ...overrides,
  }
}

export async function seedSdStatusPage(
  workspaceId: string,
  overrides: Partial<{
    name: string
    slug: string
    published: boolean
    customerId: string | null
    serviceIds: string[]
  }> = {},
) {
  return prisma.sdStatusPage.create({
    data: {
      workspaceId,
      name: overrides.name ?? 'Acme',
      slug: overrides.slug ?? `acme-${createId().slice(0, 8)}`,
      published: overrides.published ?? true,
      customerId: overrides.customerId ?? null,
      serviceIds: overrides.serviceIds ?? [],
    },
  })
}

export async function seedSdMajorIncident(
  workspaceId: string,
  ticketId: string,
  overrides: Partial<{
    status: 'INVESTIGATING' | 'IDENTIFIED' | 'MONITORING' | 'RESOLVED'
    pageIds: string[]
    childIds: string[]
    resolvedAt: Date | null
    title: string
  }> = {},
) {
  return prisma.sdMajorIncident.create({
    data: {
      workspaceId,
      ticketId,
      title: overrides.title ?? 'Instabilidade na telefonia',
      status: overrides.status ?? 'INVESTIGATING',
      resolvedAt: overrides.resolvedAt ?? null,
      pages: {
        create: (overrides.pageIds ?? []).map((pageId) => ({
          pageId,
          workspaceId,
        })),
      },
      links: {
        create: (overrides.childIds ?? []).map((id) => ({
          ticketId: id,
          workspaceId,
        })),
      },
      updates: {
        create: {
          workspaceId,
          status: overrides.status ?? 'INVESTIGATING',
          message: 'Estamos investigando.',
          publish: true,
        },
      },
    },
  })
}
