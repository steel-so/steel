import { describe, expect, it } from 'vitest'
import {
  createFakeSdMonitorAlert,
  createFakeSdMonitorSource,
} from '@/src/__tests__/factories/sd-monitor.factory'
import {
  sdMonitorWebhookPath,
  toSdMonitorAlertDTO,
  toSdMonitorSourceDTO,
  toSdMonitorSourceWithTokenDTO,
} from '../sd-monitor.mapper'

describe('toSdMonitorSourceDTO', () => {
  it('never leaks the token hash and reads the severity map', () => {
    const dto = toSdMonitorSourceDTO(
      createFakeSdMonitorSource({
        severityMap: [{ from: 'Disaster', priorityId: 'p1' }, 'lixo'],
        lastEventAt: new Date('2026-10-01T10:00:00.000Z'),
        departmentId: 'dep-1',
      }),
    )
    expect(dto).not.toHaveProperty('tokenHash')
    expect(dto).not.toHaveProperty('token')
    expect(dto.severityMap).toEqual([{ from: 'Disaster', priorityId: 'p1' }])
    expect(dto.lastEventAt).toBe('2026-10-01T10:00:00.000Z')
    expect(dto.departmentId).toBe('dep-1')
    expect(dto.createdAt).toBe('2026-10-01T12:00:00.000Z')
  })

  it('exposes the correlation settings', () => {
    const dto = toSdMonitorSourceDTO(
      createFakeSdMonitorSource({
        kind: 'GRAFANA',
        correlationMode: 'OFF',
        correlationWindowMinutes: 15,
      }),
    )
    expect(dto).toMatchObject({
      kind: 'GRAFANA',
      correlationMode: 'OFF',
      correlationWindowMinutes: 15,
    })
  })

  it('keeps a source that never received an alert as null', () => {
    expect(toSdMonitorSourceDTO(createFakeSdMonitorSource()).lastEventAt).toBe(
      null,
    )
  })
})

describe('toSdMonitorSourceWithTokenDTO', () => {
  it('adds the clear token and the webhook path', () => {
    const dto = toSdMonitorSourceWithTokenDTO(
      createFakeSdMonitorSource(),
      'tok-123',
    )
    expect(dto.token).toBe('tok-123')
    expect(dto.webhookPath).toBe('/api/servicedesk/monitoring/tok-123')
    expect(sdMonitorWebhookPath('abc')).toBe('/api/servicedesk/monitoring/abc')
  })
})

describe('toSdMonitorAlertDTO', () => {
  it('maps the relations of a linked alert', () => {
    const dto = toSdMonitorAlertDTO(
      createFakeSdMonitorAlert({
        status: 'RESOLVED',
        resolvedAt: new Date('2026-10-01T13:00:00.000Z'),
        configItemId: 'ci-1',
        configItem: { id: 'ci-1', name: 'SRV-01' },
        ticketId: 't1',
        ticket: {
          id: 't1',
          number: 42,
          type: 'INCIDENT',
          title: 'Servidor fora',
          phase: { name: 'Em andamento' },
        },
      }),
    )
    expect(dto.sourceName).toBe('Zabbix matriz')
    expect(dto.configItem).toEqual({ id: 'ci-1', name: 'SRV-01' })
    expect(dto.ticket).toEqual({
      id: 't1',
      number: 42,
      title: 'Servidor fora',
      phase: 'Em andamento',
    })
    expect(dto.resolvedAt).toBe('2026-10-01T13:00:00.000Z')
  })

  it('maps the source kind and the deduplication / correlation counters', () => {
    const dto = toSdMonitorAlertDTO(
      createFakeSdMonitorAlert({
        correlated: true,
        occurrences: 4,
        lastSeenAt: new Date('2026-10-01T14:00:00.000Z'),
        source: { id: 'src-2', name: 'PRTG', kind: 'PRTG' },
      }),
    )
    expect(dto).toMatchObject({
      sourceKind: 'PRTG',
      correlated: true,
      occurrences: 4,
      lastSeenAt: '2026-10-01T14:00:00.000Z',
    })
  })

  it('maps an alert with no ticket and no CI', () => {
    const bare = toSdMonitorAlertDTO(createFakeSdMonitorAlert())
    expect(bare.ticket).toBeNull()
    expect(bare.configItem).toBeNull()
    expect(bare.resolvedAt).toBeNull()
    expect(bare.status).toBe('OPEN')
    expect(bare.startedAt).toBe('2026-10-01T12:00:00.000Z')
  })
})
