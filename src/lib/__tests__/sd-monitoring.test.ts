import { describe, expect, it } from 'vitest'
import {
  parseSdMonitorEvents,
  parseSdMonitorPayload,
  SD_GRAFANA_SEVERITIES,
  SD_MONITOR_MAX_EVENTS,
  SD_PRTG_PAYLOAD_EXAMPLE,
  SD_PRTG_SEVERITIES,
  SD_ZABBIX_MEDIA_TYPE_FIELDS,
  SD_ZABBIX_SEVERITIES,
  sdMonitorCorrelationKey,
  sdMonitorHostCandidates,
  sdMonitorPriorityId,
  sdMonitorSeverityMap,
  sdMonitorTicketBody,
  sdZabbixPayloadExample,
} from '../servicedesk/monitoring'

/** Corpo que o tipo de mídia do Zabbix manda num problema. */
const zabbix = {
  eventId: '31415',
  eventValue: '1',
  eventStatus: 'PROBLEM',
  eventName: 'Sem resposta do agente no SRV-01',
  eventSeverity: 'Disaster',
  eventDate: '2026.10.01',
  eventTime: '14:03:12',
  eventTags: 'scope: availability, service: rede',
  hostName: 'SRV-01',
  hostIp: '10.0.0.4',
  message: 'ICMP ping falhou há 5 minutos',
}

describe('parseSdMonitorPayload — Zabbix', () => {
  it('reads every documented media-type field', () => {
    const event = parseSdMonitorPayload(zabbix)
    expect(event).not.toBeNull()
    if (!event) return
    expect(event.externalId).toBe('31415')
    expect(event.resolved).toBe(false)
    expect(event.subject).toBe('Sem resposta do agente no SRV-01')
    expect(event.severity).toBe('Disaster')
    expect(event.host).toBe('SRV-01')
    expect(event.body).toBe('ICMP ping falhou há 5 minutos')
    expect(event.tags).toEqual(['scope: availability', 'service: rede'])
    // `{EVENT.DATE}`/`{EVENT.TIME}` vêm sem fuso: valem como hora local.
    expect(event.startedAt?.getTime()).toBe(
      new Date('2026-10-01T14:03:12').getTime(),
    )
  })

  it('treats RESOLVED and {EVENT.VALUE} 0 as a recovery', () => {
    expect(
      parseSdMonitorPayload({ ...zabbix, eventStatus: 'RESOLVED' })?.resolved,
    ).toBe(true)
    const { eventStatus: _ignored, ...withoutStatus } = zabbix
    expect(
      parseSdMonitorPayload({ ...withoutStatus, eventValue: '0' })?.resolved,
    ).toBe(true)
    expect(
      parseSdMonitorPayload({ ...withoutStatus, eventValue: 1 })?.resolved,
    ).toBe(false)
  })

  it('falls back to the host ip and to the alert message', () => {
    const event = parseSdMonitorPayload({
      eventId: '7',
      hostIp: '10.0.0.4',
      message: 'Disco cheio\nsegunda linha',
    })
    expect(event?.host).toBe('10.0.0.4')
    expect(event?.subject).toBe('Disco cheio')
    expect(event?.body).toBe('Disco cheio\nsegunda linha')
  })

  it('documents the exact script fields and renders the example body', () => {
    expect(SD_ZABBIX_MEDIA_TYPE_FIELDS).toContainEqual([
      'eventId',
      '{EVENT.ID}',
    ])
    const example = sdZabbixPayloadExample()
    expect(example).toContain('"eventId": "{EVENT.ID}"')
    expect(example).toContain('"hostName": "{HOST.NAME}"')
    expect(JSON.parse(example).eventSeverity).toBe('{EVENT.SEVERITY}')
  })
})

describe('parseSdMonitorPayload — generic', () => {
  it('reads the documented generic shape', () => {
    const event = parseSdMonitorPayload({
      externalId: 'cpu-srv2',
      status: 'PROBLEM',
      severity: 'high',
      host: 'srv-02',
      subject: 'CPU acima de 90%',
      body: 'Média de 5 minutos em 94%',
      tags: ['infra', 'cpu', 'infra'],
      startedAt: '2026-10-01T12:00:00.000Z',
    })
    expect(event?.externalId).toBe('cpu-srv2')
    expect(event?.tags).toEqual(['infra', 'cpu'])
    expect(event?.startedAt?.toISOString()).toBe('2026-10-01T12:00:00.000Z')
  })

  it.each([
    ['ok', true],
    ['RESOLVED', true],
    ['recovered', true],
    ['firing', false],
    ['problem', false],
  ])('maps the status %s', (status, resolved) => {
    expect(parseSdMonitorPayload({ subject: 'x', status })?.resolved).toBe(
      resolved,
    )
  })

  it('defaults to a problem when no status comes at all', () => {
    expect(parseSdMonitorPayload({ subject: 'x' })?.resolved).toBe(false)
  })

  it('derives a stable key when the alert has no id', () => {
    const first = parseSdMonitorPayload({ host: 'srv-03', subject: 'Queda' })
    const again = parseSdMonitorPayload({ host: 'srv-03', subject: 'Queda' })
    const other = parseSdMonitorPayload({ host: 'srv-04', subject: 'Queda' })
    expect(first?.externalId).toMatch(/^auto:[0-9a-f]{32}$/)
    expect(again?.externalId).toBe(first?.externalId)
    expect(other?.externalId).not.toBe(first?.externalId)
  })

  it('accepts tags as an object map and as a comma separated string', () => {
    expect(
      parseSdMonitorPayload({ subject: 'x', tags: { env: 'prod' } })?.tags,
    ).toEqual(['env: prod'])
    expect(parseSdMonitorPayload({ subject: 'x', tags: 'a, b' })?.tags).toEqual(
      ['a', 'b'],
    )
    expect(parseSdMonitorPayload({ subject: 'x', tags: [1, 2] })?.tags).toEqual(
      [],
    )
    expect(parseSdMonitorPayload({ subject: 'x', tags: 7 })?.tags).toEqual([])
  })

  it('reads epoch seconds, epoch millis and unparsable dates', () => {
    expect(
      parseSdMonitorPayload({ subject: 'x', timestamp: '1790000000' })
        ?.startedAt,
    ).toBeInstanceOf(Date)
    expect(
      parseSdMonitorPayload({ subject: 'x', timestamp: '1790000000000' })
        ?.startedAt,
    ).toBeInstanceOf(Date)
    expect(
      parseSdMonitorPayload({ subject: 'x', startedAt: 'ontem' })?.startedAt,
    ).toBeNull()
    expect(
      parseSdMonitorPayload({ subject: 'x', eventDate: 'não é data' })
        ?.startedAt,
    ).toBeNull()
    expect(parseSdMonitorPayload({ subject: 'x' })?.startedAt).toBeNull()
  })

  it('truncates a very long subject and body', () => {
    const event = parseSdMonitorPayload({
      subject: 'a'.repeat(400),
      body: 'b'.repeat(9000),
      externalId: 'x'.repeat(300),
    })
    expect(event?.subject).toHaveLength(200)
    expect(event?.body).toHaveLength(8000)
    expect(event?.externalId).toHaveLength(200)
  })

  it('refuses what cannot become an alert', () => {
    expect(parseSdMonitorPayload(null)).toBeNull()
    expect(parseSdMonitorPayload('texto')).toBeNull()
    expect(parseSdMonitorPayload([{ subject: 'x' }])).toBeNull()
    expect(parseSdMonitorPayload({})).toBeNull()
    expect(parseSdMonitorPayload({ host: 'srv' })).toBeNull()
    expect(parseSdMonitorPayload({ subject: '   \n  ' })).toBeNull()
  })

  it('accepts a boolean flag as a scalar value', () => {
    expect(
      parseSdMonitorPayload({ subject: 'x', status: false })?.resolved,
    ).toBe(true)
  })
})

describe('sdMonitorSeverityMap / sdMonitorPriorityId', () => {
  const map = [
    { from: 'Disaster', priorityId: 'p-critica' },
    { from: 'warning', priorityId: 'p-baixa' },
  ]

  it('matches the severity ignoring case and spacing', () => {
    expect(sdMonitorPriorityId(map, 'disaster')).toBe('p-critica')
    expect(sdMonitorPriorityId(map, ' WARNING ')).toBe('p-baixa')
    expect(sdMonitorPriorityId(map, 'average')).toBeNull()
    expect(sdMonitorPriorityId(map, null)).toBeNull()
  })

  it('reads the stored json and drops broken entries', () => {
    expect(
      sdMonitorSeverityMap([
        { from: 'high', priorityId: 'p1' },
        { from: 'high' },
        { priorityId: 'p2' },
        'lixo',
        null,
      ]),
    ).toEqual([{ from: 'high', priorityId: 'p1' }])
    expect(sdMonitorSeverityMap('lixo')).toEqual([])
  })
})

describe('sdMonitorTicketBody', () => {
  it('describes the alert and escapes the content', () => {
    const event = parseSdMonitorPayload({
      ...zabbix,
      eventName: 'CPU <alta> & "quente"',
      message: 'linha 1\nlinha 2',
    })
    expect(event).not.toBeNull()
    if (!event) return
    const html = sdMonitorTicketBody(event, 'Zabbix matriz')
    expect(html).toContain('<strong>Origem:</strong> Zabbix matriz')
    expect(html).toContain('<strong>Host:</strong> SRV-01')
    expect(html).toContain('<strong>Severidade:</strong> Disaster')
    expect(html).toContain('<strong>Identificador:</strong> 31415')
    expect(html).toContain('scope: availability')
    expect(html).toContain('linha 1<br />linha 2')
    expect(html).not.toContain('<alta>')
  })

  it('omits the empty rows', () => {
    const event = parseSdMonitorPayload({ externalId: 'a', subject: 'Queda' })
    expect(event).not.toBeNull()
    if (!event) return
    const html = sdMonitorTicketBody(event, 'Webhook')
    expect(html).not.toContain('Host:')
    expect(html).not.toContain('Severidade:')
    expect(html).not.toContain('Tags:')
  })
})

describe('host aliases', () => {
  it('keeps the other names of the machine apart from the main host', () => {
    const event = parseSdMonitorPayload(zabbix)
    expect(event?.host).toBe('SRV-01')
    expect(event?.hostAliases).toEqual(['10.0.0.4'])
    expect(event?.raw).toBe(zabbix)
  })

  it('has no aliases when the body only names one host', () => {
    const event = parseSdMonitorPayload({ subject: 'x', host: 'a' })
    expect(event?.hostAliases).toEqual([])
  })
})

const grafanaAlert = {
  status: 'firing',
  fingerprint: 'abc123',
  labels: {
    alertname: 'CPU alta',
    instance: 'srv-02.lan:9100',
    severity: 'critical',
    team: 'infra',
  },
  annotations: { summary: 'CPU acima de 90%', description: 'Média de 94%' },
  startsAt: '2026-10-29T10:00:00Z',
  generatorURL: 'https://grafana.exemplo/alerting/1',
}

describe('parseSdMonitorEvents — Grafana', () => {
  it('reads every alert of the batch', () => {
    const events = parseSdMonitorEvents('GRAFANA', {
      title: 'ignored',
      alerts: [
        grafanaAlert,
        { ...grafanaAlert, fingerprint: 'def456', status: 'resolved' },
      ],
    })
    expect(events).toHaveLength(2)
    const [first, second] = events
    expect(first).toMatchObject({
      externalId: 'abc123',
      resolved: false,
      severity: 'critical',
      host: 'srv-02.lan',
      subject: 'CPU acima de 90%',
      startedAt: new Date('2026-10-29T10:00:00Z'),
    })
    expect(first.body).toContain('Média de 94%')
    expect(first.body).toContain('Painel: https://grafana.exemplo/alerting/1')
    expect(first.tags).toContain('team: infra')
    expect(first.tags.some((t) => t.startsWith('alertname'))).toBe(false)
    expect(second.resolved).toBe(true)
    expect(second.externalId).toBe('def456')
  })

  it('works for any source kind that points at an Alertmanager', () => {
    expect(
      parseSdMonitorEvents('WEBHOOK', { alerts: [grafanaAlert] }),
    ).toHaveLength(1)
  })

  it('names the host from the first available label and keeps the rest as aliases', () => {
    const [event] = parseSdMonitorEvents('GRAFANA', {
      alerts: [
        {
          status: 'firing',
          labels: {
            alertname: 'Disco',
            host: 'srv-03',
            hostname: 'srv-03.lan',
            nodename: 'node-3',
            node: 'n3',
            instance: '10.0.0.3:9100',
          },
        },
      ],
    })
    expect(event.host).toBe('srv-03')
    expect(event.hostAliases).toEqual([
      'srv-03.lan',
      'node-3',
      'n3',
      '10.0.0.3',
    ])
  })

  it('does not cut an IPv6 instance', () => {
    const [event] = parseSdMonitorEvents('GRAFANA', {
      alerts: [{ labels: { alertname: 'x', instance: '[::1]:9100' } }],
    })
    expect(event.host).toBe('[::1]:9100')
  })

  it('derives a stable key from the labels when there is no fingerprint', () => {
    const make = (labels: Record<string, string>) =>
      parseSdMonitorEvents('GRAFANA', {
        alerts: [{ status: 'firing', labels }],
      })[0].externalId
    const a = make({ alertname: 'CPU', host: 'a', env: 'prod' })
    expect(a).toMatch(/^auto:[0-9a-f]{32}$/)
    expect(make({ env: 'prod', host: 'a', alertname: 'CPU' })).toBe(a)
    expect(make({ alertname: 'CPU', host: 'b', env: 'prod' })).not.toBe(a)
  })

  it('falls back to the alert name, the top-level title and the message', () => {
    const [byName] = parseSdMonitorEvents('GRAFANA', {
      alerts: [{ labels: { alertname: 'Fila cheia' } }],
    })
    expect(byName.subject).toBe('Fila cheia')
    expect(byName.body).toBeNull()
    expect(byName.severity).toBeNull()
    expect(byName.host).toBeNull()

    const [byTitle] = parseSdMonitorEvents('GRAFANA', {
      title: '[FIRING] Latência',
      message: 'Detalhes',
      alerts: [{ labels: { priority: 'P1' } }],
    })
    expect(byTitle.subject).toBe('[FIRING] Latência')
    expect(byTitle.body).toBe('Detalhes')
    expect(byTitle.severity).toBe('P1')
  })

  it('uses a description as the subject when nothing else names the alert', () => {
    const [event] = parseSdMonitorEvents('GRAFANA', {
      alerts: [
        { annotations: { description: 'Só a descrição\nsegunda linha' } },
      ],
    })
    expect(event.subject).toBe('Só a descrição')
  })

  it('ignores invalid dates, non-http links and entries that are not alerts', () => {
    const events = parseSdMonitorEvents('GRAFANA', {
      alerts: [
        'texto',
        42,
        null,
        { annotations: {} },
        {
          labels: { alertname: 'A' },
          startsAt: '0001-01-01T00:00:00Z',
          generatorURL: 'javascript:alert(1)',
        },
        { labels: { alertname: 'B' }, startsAt: 'nope' },
        { labels: { alertname: '   ' } },
      ],
    })
    expect(events.map((e) => e.subject)).toEqual(['A', 'B'])
    expect(events[0].startedAt).toBeNull()
    expect(events[0].body).toBeNull()
    expect(events[1].startedAt).toBeNull()
  })

  it('reads numeric labels and skips ones that are not scalars', () => {
    const [event] = parseSdMonitorEvents('GRAFANA', {
      alerts: [
        { labels: { alertname: 'N', port: 9100, nested: { a: 1 }, list: [1] } },
      ],
    })
    expect(event.tags).toEqual(['port: 9100'])
  })

  it('caps the batch', () => {
    const alerts = Array.from(
      { length: SD_MONITOR_MAX_EVENTS + 5 },
      (_, i) => ({
        labels: { alertname: `a${i}` },
      }),
    )
    expect(parseSdMonitorEvents('GRAFANA', { alerts })).toHaveLength(
      SD_MONITOR_MAX_EVENTS,
    )
  })
})

describe('parseSdMonitorEvents — PRTG', () => {
  const prtg = {
    sensorId: '2001',
    device: 'SRV-01',
    host: '10.0.0.4',
    sensor: 'Ping',
    status: 'Down (Partial)',
    message: 'Timeout',
    lastValue: '0 ms',
    group: 'Matriz',
    probe: 'Local',
  }

  it('reads a sensor in alarm', () => {
    const [event] = parseSdMonitorEvents('PRTG', prtg)
    expect(event).toMatchObject({
      externalId: 'sensor-2001',
      resolved: false,
      severity: 'Down',
      host: 'SRV-01',
      hostAliases: ['10.0.0.4'],
      subject: 'Ping em SRV-01',
      startedAt: null,
    })
    expect(event.body).toBe(
      'Timeout\nStatus: Down (Partial)\nÚltimo valor: 0 ms',
    )
    expect(event.tags).toEqual(['grupo: Matriz', 'probe: Local'])
  })

  it('treats Up (and OK) as the recovery, without severity', () => {
    const [up] = parseSdMonitorEvents('PRTG', { ...prtg, status: 'Up' })
    expect(up.resolved).toBe(true)
    expect(up.severity).toBeNull()
    const [ok] = parseSdMonitorEvents('PRTG', { ...prtg, status: 'OK' })
    expect(ok.resolved).toBe(true)
  })

  it('works with only a sensor, only a device or no sensor id', () => {
    const [onlySensor] = parseSdMonitorEvents('PRTG', { sensor: 'HTTP' })
    expect(onlySensor.subject).toBe('HTTP')
    expect(onlySensor.host).toBeNull()
    expect(onlySensor.severity).toBeNull()
    expect(onlySensor.body).toBeNull()
    expect(onlySensor.tags).toEqual([])
    expect(onlySensor.externalId).toMatch(/^auto:/)

    const [onlyDevice] = parseSdMonitorEvents('PRTG', {
      deviceName: 'SW-01',
      hostIp: '10.0.0.9',
      status: 'Warning',
    })
    expect(onlyDevice.subject).toBe('SW-01')
    expect(onlyDevice.host).toBe('SW-01')
    expect(onlyDevice.hostAliases).toEqual(['10.0.0.9'])
    expect(onlyDevice.severity).toBe('Warning')
  })

  it('falls back to the host field when the device is missing', () => {
    const [event] = parseSdMonitorEvents('PRTG', {
      sensor: 'Ping',
      host: '10.0.0.9',
    })
    expect(event.host).toBe('10.0.0.9')
    expect(event.hostAliases).toEqual([])
  })

  it('refuses a body with neither sensor nor device', () => {
    expect(parseSdMonitorEvents('PRTG', { status: 'Down' })).toEqual([])
  })

  it('ships a copyable example with the PRTG placeholders', () => {
    expect(SD_PRTG_PAYLOAD_EXAMPLE).toContain('"%sensorid"')
    expect(JSON.parse(SD_PRTG_PAYLOAD_EXAMPLE).status).toBe('%status')
    expect(SD_PRTG_SEVERITIES).toContain('Down')
    expect(SD_GRAFANA_SEVERITIES).toContain('critical')
    expect(SD_ZABBIX_SEVERITIES).toContain('Disaster')
  })
})

describe('parseSdMonitorEvents — Zabbix and generic', () => {
  it('wraps the single alert in a list', () => {
    expect(parseSdMonitorEvents('ZABBIX', zabbix)).toHaveLength(1)
    expect(parseSdMonitorEvents('WEBHOOK', { subject: 'x' })).toHaveLength(1)
  })

  it('returns an empty list for anything unreadable', () => {
    expect(parseSdMonitorEvents('ZABBIX', null)).toEqual([])
    expect(parseSdMonitorEvents('ZABBIX', 'texto')).toEqual([])
    expect(parseSdMonitorEvents('ZABBIX', [zabbix])).toEqual([])
    expect(parseSdMonitorEvents('ZABBIX', { foo: 'bar' })).toEqual([])
    expect(parseSdMonitorEvents('PRTG', 7)).toEqual([])
  })

  it('understands the legacy Grafana rule fields', () => {
    const [event] = parseSdMonitorEvents('GRAFANA_LEGACY', {
      ruleId: 9,
      ruleName: 'Memória',
      state: 'ok',
      message: 'voltou',
    })
    expect(event).toMatchObject({
      externalId: '9',
      subject: 'Memória',
      resolved: true,
    })
  })
})

describe('sdMonitorHostCandidates / sdMonitorCorrelationKey', () => {
  it('lowercases, dedupes and appends the short name of an FQDN last', () => {
    expect(
      sdMonitorHostCandidates([
        ' SRV-01.lan.exemplo ',
        'srv-01.lan.exemplo',
        '',
      ]),
    ).toEqual(['srv-01.lan.exemplo', 'srv-01'])
  })

  it('keeps IPs whole and does not repeat a short name already listed', () => {
    expect(
      sdMonitorHostCandidates(['10.0.0.4', 'srv-01', 'srv-01.lan']),
    ).toEqual(['10.0.0.4', 'srv-01', 'srv-01.lan'])
    expect(sdMonitorHostCandidates([])).toEqual([])
  })

  it('keys by CI first, then by the short host name', () => {
    expect(sdMonitorCorrelationKey('ci-1', 'srv-01')).toBe('ci:ci-1')
    expect(sdMonitorCorrelationKey(null, 'SRV-01.lan')).toBe('host:srv-01')
    expect(sdMonitorCorrelationKey(null, '10.0.0.4')).toBe('host:10.0.0.4')
    expect(sdMonitorCorrelationKey(null, '  ')).toBeNull()
    expect(sdMonitorCorrelationKey(null, null)).toBeNull()
    expect(sdMonitorCorrelationKey(null, '.lan')).toBeNull()
  })
})
