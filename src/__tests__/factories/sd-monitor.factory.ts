import { createId } from '@paralleldrive/cuid2'
import type { Prisma, SdMonitorSource } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type { SdMonitorAlertWithRelations } from '@/src/repositories/sd-monitor-alert.repository'
import { hashSdMonitorToken } from '@/src/services/sd-monitor-source.service'

/**
 * Fábricas do monitoramento do ServiceDesk (origens e alertas). O token
 * nasce conhecido nos testes (`sdMonitorToken`) para a entrada pública poder
 * ser exercitada ponta a ponta.
 */

const fixed = () => new Date('2026-10-01T12:00:00.000Z')

/** Token determinístico e o hash correspondente. */
export function sdMonitorToken(seed = 'token-de-teste-para-monitoramento') {
  return { token: seed, hash: hashSdMonitorToken(seed) }
}

export function createFakeSdMonitorSource(
  overrides?: Partial<SdMonitorSource>,
): SdMonitorSource {
  return {
    id: 'src-1',
    workspaceId: 'ws1',
    name: 'Zabbix matriz',
    kind: 'ZABBIX',
    tokenHash: sdMonitorToken().hash,
    active: true,
    ticketType: 'INCIDENT',
    departmentId: null,
    categoryId: null,
    customerId: null,
    severityMap: [],
    autoResolve: true,
    flappingWindowMinutes: 30,
    correlationMode: 'HOST',
    correlationWindowMinutes: 60,
    lastEventAt: null,
    createdById: 'u1',
    createdAt: fixed(),
    updatedAt: fixed(),
    deletedAt: null,
    ...overrides,
  }
}

export function createFakeSdMonitorAlert(
  overrides?: Partial<SdMonitorAlertWithRelations>,
): SdMonitorAlertWithRelations {
  return {
    id: createId(),
    workspaceId: 'ws1',
    sourceId: 'src-1',
    ticketId: null,
    externalId: '12345',
    status: 'OPEN',
    severity: 'Disaster',
    host: 'SRV-01',
    configItemId: null,
    subject: 'Sem resposta do agente no SRV-01',
    body: 'ICMP ping falhou',
    payload: {},
    startedAt: fixed(),
    resolvedAt: null,
    createdAt: fixed(),
    correlationKey: null,
    correlated: false,
    occurrences: 1,
    lastSeenAt: fixed(),
    source: { id: 'src-1', name: 'Zabbix matriz', kind: 'ZABBIX' },
    configItem: null,
    ticket: null,
    ...overrides,
  }
}

export async function seedSdMonitorSource(
  workspaceId: string,
  createdById: string,
  overrides?: Partial<Prisma.SdMonitorSourceUncheckedCreateInput>,
) {
  return prisma.sdMonitorSource.create({
    data: {
      workspaceId,
      createdById,
      name: 'Zabbix matriz',
      tokenHash: sdMonitorToken(`tok-${createId()}`).hash,
      ...overrides,
    },
  })
}

export async function seedSdMonitorAlert(
  workspaceId: string,
  sourceId: string,
  overrides?: Partial<Prisma.SdMonitorAlertUncheckedCreateInput>,
) {
  return prisma.sdMonitorAlert.create({
    data: {
      workspaceId,
      sourceId,
      externalId: createId(),
      subject: 'Sem resposta do agente no SRV-01',
      ...overrides,
    },
  })
}
