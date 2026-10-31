import { describe, expect, it } from 'vitest'
import {
  CreateSdMaintenanceSchema,
  CreateSdStatusComponentSchema,
  UpdateSdMaintenanceSchema,
  UpdateSdStatusComponentSchema,
} from '../sd-status-maintenance.schema'

describe('CreateSdStatusComponentSchema', () => {
  it('defaults to operational and trims the name', () => {
    expect(
      CreateSdStatusComponentSchema.parse({ name: '  Telefonia ' }),
    ).toEqual({ name: 'Telefonia', state: 'OPERATIONAL' })
  })

  it('takes a service and any known state, nothing else', () => {
    expect(
      CreateSdStatusComponentSchema.parse({
        name: 'Portal',
        serviceId: 's1',
        state: 'OUTAGE',
      }),
    ).toMatchObject({ serviceId: 's1', state: 'OUTAGE' })
    expect(
      CreateSdStatusComponentSchema.safeParse({ name: 'Portal', state: 'X' })
        .success,
    ).toBe(false)
    expect(CreateSdStatusComponentSchema.safeParse({ name: 'a' }).success).toBe(
      false,
    )
  })
})

describe('UpdateSdStatusComponentSchema', () => {
  it('needs at least one field and allows unlinking the service', () => {
    expect(UpdateSdStatusComponentSchema.safeParse({}).success).toBe(false)
    expect(UpdateSdStatusComponentSchema.parse({ serviceId: null })).toEqual({
      serviceId: null,
    })
    expect(
      UpdateSdStatusComponentSchema.safeParse({ position: -1 }).success,
    ).toBe(false)
  })
})

describe('CreateSdMaintenanceSchema', () => {
  const base = {
    title: 'Troca do switch',
    startsAt: '2026-11-10T22:00:00-03:00',
    endsAt: '2026-11-11T02:00:00Z',
    pageIds: ['p1'],
  }

  it('parses the dates with their offset and fills the defaults', () => {
    const parsed = CreateSdMaintenanceSchema.parse(base)
    expect(parsed.startsAt).toEqual(new Date('2026-11-11T01:00:00.000Z'))
    expect(parsed.endsAt).toEqual(new Date('2026-11-11T02:00:00.000Z'))
    expect(parsed).toMatchObject({
      suppressMonitoring: false,
      configItemIds: [],
      notifySubscribers: true,
    })
    expect(parsed.description).toBeUndefined()
  })

  it('refuses dates without offset, no pages and short titles', () => {
    expect(
      CreateSdMaintenanceSchema.safeParse({
        ...base,
        startsAt: '2026-11-10T22:00:00',
      }).success,
    ).toBe(false)
    expect(
      CreateSdMaintenanceSchema.safeParse({ ...base, pageIds: [] }).success,
    ).toBe(false)
    expect(
      CreateSdMaintenanceSchema.safeParse({ ...base, title: 'ab' }).success,
    ).toBe(false)
  })
})

describe('UpdateSdMaintenanceSchema', () => {
  it('is partial but not empty', () => {
    expect(UpdateSdMaintenanceSchema.safeParse({}).success).toBe(false)
    expect(
      UpdateSdMaintenanceSchema.parse({
        description: null,
        title: 'Novo nome',
      }),
    ).toEqual({ description: null, title: 'Novo nome' })
  })
})
