import { describe, expect, it } from 'vitest'
import {
  CreateSdMonitorSourceSchema,
  LinkSdMonitorAlertSchema,
  ListSdMonitorAlertsSchema,
  ListSdMonitorSourcesSchema,
  SdMonitorSeverityMapSchema,
  SdMonitorTokenSchema,
  UpdateSdMonitorSourceSchema,
} from '../sd-monitor-source.schema'

describe('CreateSdMonitorSourceSchema', () => {
  it('fills the ITIL defaults from just a name', () => {
    const parsed = CreateSdMonitorSourceSchema.parse({ name: ' Zabbix  ' })
    expect(parsed).toEqual({
      name: 'Zabbix',
      kind: 'ZABBIX',
      active: true,
      ticketType: 'INCIDENT',
      severityMap: [],
      autoResolve: true,
      flappingWindowMinutes: 30,
      correlationMode: 'HOST',
      correlationWindowMinutes: 60,
    })
  })

  it('accepts the full configuration', () => {
    const parsed = CreateSdMonitorSourceSchema.parse({
      name: 'Prometheus',
      kind: 'WEBHOOK',
      active: false,
      ticketType: 'PROBLEM',
      departmentId: 'dep-1',
      categoryId: 'cat-1',
      customerId: null,
      severityMap: [{ from: ' Disaster ', priorityId: 'p1' }],
      autoResolve: false,
      flappingWindowMinutes: 0,
    })
    expect(parsed.kind).toBe('WEBHOOK')
    expect(parsed.severityMap).toEqual([{ from: 'Disaster', priorityId: 'p1' }])
    expect(parsed.customerId).toBeNull()
  })

  it('rejects an empty name, an unknown kind and a long window', () => {
    expect(CreateSdMonitorSourceSchema.safeParse({ name: ' ' }).success).toBe(
      false,
    )
    expect(
      CreateSdMonitorSourceSchema.safeParse({ name: 'x', kind: 'NAGIOS' })
        .success,
    ).toBe(false)
    expect(
      CreateSdMonitorSourceSchema.safeParse({
        name: 'x',
        flappingWindowMinutes: 1441,
      }).success,
    ).toBe(false)
    expect(
      CreateSdMonitorSourceSchema.safeParse({
        name: 'x',
        flappingWindowMinutes: -1,
      }).success,
    ).toBe(false)
    expect(
      CreateSdMonitorSourceSchema.safeParse({
        name: 'x',
        flappingWindowMinutes: 1.5,
      }).success,
    ).toBe(false)
  })
})

describe('SdMonitorSeverityMapSchema', () => {
  it('refuses a repeated severity and an entry without priority', () => {
    expect(
      SdMonitorSeverityMapSchema.safeParse([
        { from: 'high', priorityId: 'p1' },
        { from: 'HIGH', priorityId: 'p2' },
      ]).success,
    ).toBe(false)
    expect(
      SdMonitorSeverityMapSchema.safeParse([{ from: 'high' }]).success,
    ).toBe(false)
    expect(
      SdMonitorSeverityMapSchema.safeParse([{ from: '', priorityId: 'p' }])
        .success,
    ).toBe(false)
  })

  it('caps the map at 20 severities', () => {
    const many = Array.from({ length: 21 }, (_, i) => ({
      from: `s${i}`,
      priorityId: 'p1',
    }))
    expect(SdMonitorSeverityMapSchema.safeParse(many).success).toBe(false)
    expect(
      SdMonitorSeverityMapSchema.safeParse(many.slice(0, 20)).success,
    ).toBe(true)
  })
})

describe('UpdateSdMonitorSourceSchema', () => {
  it('needs at least one field', () => {
    expect(UpdateSdMonitorSourceSchema.safeParse({}).success).toBe(false)
    expect(
      UpdateSdMonitorSourceSchema.safeParse({ active: false }).success,
    ).toBe(true)
  })

  it('allows clearing the ticket defaults with null', () => {
    const parsed = UpdateSdMonitorSourceSchema.parse({
      departmentId: null,
      categoryId: null,
      customerId: null,
    })
    expect(parsed).toEqual({
      departmentId: null,
      categoryId: null,
      customerId: null,
    })
  })
})

describe('list schemas', () => {
  it('reads the query strings', () => {
    expect(ListSdMonitorSourcesSchema.parse({})).toEqual({
      includeInactive: false,
    })
    expect(
      ListSdMonitorSourcesSchema.parse({ includeInactive: 'true' }),
    ).toEqual({ includeInactive: true })
    expect(ListSdMonitorAlertsSchema.parse({})).toEqual({
      limit: 20,
      unmatched: false,
    })
    expect(
      ListSdMonitorAlertsSchema.parse({
        sourceId: 'src-1',
        ticketId: 't1',
        status: 'RESOLVED',
        limit: '50',
      }),
    ).toEqual({
      sourceId: 'src-1',
      ticketId: 't1',
      status: 'RESOLVED',
      limit: 50,
      unmatched: false,
    })
    expect(
      ListSdMonitorAlertsSchema.parse({
        configItemId: 'ci-1',
        unmatched: 'true',
      }),
    ).toEqual({ configItemId: 'ci-1', unmatched: true, limit: 20 })
    expect(ListSdMonitorAlertsSchema.safeParse({ limit: '500' }).success).toBe(
      false,
    )
    expect(ListSdMonitorAlertsSchema.safeParse({ status: 'MEH' }).success).toBe(
      false,
    )
  })
})

describe('SdMonitorTokenSchema', () => {
  it('accepts base64url tokens and refuses anything else', () => {
    expect(SdMonitorTokenSchema.safeParse('a'.repeat(43)).success).toBe(true)
    expect(SdMonitorTokenSchema.safeParse('ab-_09').success).toBe(false)
    expect(SdMonitorTokenSchema.safeParse(`${'a'.repeat(42)}/`).success).toBe(
      false,
    )
    expect(SdMonitorTokenSchema.safeParse('a'.repeat(201)).success).toBe(false)
  })
})

describe('correlation and the new kinds', () => {
  it('accepts Grafana and PRTG sources with their correlation settings', () => {
    for (const kind of ['GRAFANA', 'PRTG']) {
      expect(
        CreateSdMonitorSourceSchema.parse({
          name: 'x',
          kind,
          correlationMode: 'OFF',
          correlationWindowMinutes: 120,
        }),
      ).toMatchObject({
        kind,
        correlationMode: 'OFF',
        correlationWindowMinutes: 120,
      })
    }
  })

  it('bounds the correlation window and the mode', () => {
    for (const bad of [0, 1441, 1.5]) {
      expect(
        CreateSdMonitorSourceSchema.safeParse({
          name: 'x',
          correlationWindowMinutes: bad,
        }).success,
      ).toBe(false)
    }
    expect(
      CreateSdMonitorSourceSchema.safeParse({
        name: 'x',
        correlationMode: 'ALL',
      }).success,
    ).toBe(false)
    expect(
      UpdateSdMonitorSourceSchema.parse({ correlationMode: 'HOST' }),
    ).toEqual({ correlationMode: 'HOST' })
  })
})

describe('LinkSdMonitorAlertSchema', () => {
  it('links, remembers or unlinks', () => {
    expect(LinkSdMonitorAlertSchema.parse({ configItemId: 'ci-1' })).toEqual({
      configItemId: 'ci-1',
      remember: false,
    })
    expect(
      LinkSdMonitorAlertSchema.parse({ configItemId: null, remember: true }),
    ).toEqual({ configItemId: null, remember: true })
    expect(LinkSdMonitorAlertSchema.safeParse({}).success).toBe(false)
    expect(
      LinkSdMonitorAlertSchema.safeParse({ configItemId: '' }).success,
    ).toBe(false)
  })
})
