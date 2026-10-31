import { describe, expect, it } from 'vitest'
import {
  CreateSchedAppointmentSchema,
  CreateSchedProfessionalSchema,
  CreateSchedServiceSchema,
  SchedAppointmentsQuerySchema,
  SchedSlotsQuerySchema,
  SchedWeeklyHoursSchema,
  UpdateSchedAppointmentSchema,
  UpdateSchedProfessionalSchema,
  UpdateSchedServiceSchema,
  UpdateSchedulingSettingsSchema,
} from '../whatsapp-scheduling.schema'

describe('SchedWeeklyHoursSchema', () => {
  it('accepts windows and rejects inverted or malformed ones', () => {
    expect(
      SchedWeeklyHoursSchema.safeParse({
        '1': [{ start: '09:00', end: '12:00' }],
      }).success,
    ).toBe(true)
    expect(
      SchedWeeklyHoursSchema.safeParse({
        '1': [{ start: '12:00', end: '09:00' }],
      }).success,
    ).toBe(false)
    expect(SchedWeeklyHoursSchema.safeParse({ '7': [] }).success).toBe(false)
    expect(
      SchedWeeklyHoursSchema.safeParse({ '1': [{ start: '9h', end: '12:00' }] })
        .success,
    ).toBe(false)
  })
})

describe('settings schema', () => {
  it('checks the zone and the reminder list', () => {
    expect(
      UpdateSchedulingSettingsSchema.safeParse({
        timezone: 'America/Sao_Paulo',
        reminderOffsets: [1440, 120],
      }).success,
    ).toBe(true)
    expect(
      UpdateSchedulingSettingsSchema.safeParse({ timezone: 'Mars/Base' })
        .success,
    ).toBe(false)
    expect(
      UpdateSchedulingSettingsSchema.safeParse({
        reminderOffsets: [60, 120, 180, 240],
      }).success,
    ).toBe(false)
    expect(
      UpdateSchedulingSettingsSchema.safeParse({ reminderOffsets: [5] })
        .success,
    ).toBe(false)
  })
})

describe('services and professionals', () => {
  it('defaults the buffer and bounds the duration', () => {
    expect(
      CreateSchedServiceSchema.parse({ name: 'Corte', durationMinutes: 30 })
        .bufferMinutes,
    ).toBe(0)
    expect(
      CreateSchedServiceSchema.safeParse({ name: 'Corte', durationMinutes: 4 })
        .success,
    ).toBe(false)
    expect(
      CreateSchedServiceSchema.safeParse({
        name: 'Corte',
        durationMinutes: 481,
      }).success,
    ).toBe(false)
    expect(UpdateSchedServiceSchema.safeParse({ active: false }).success).toBe(
      true,
    )
  })

  it('defaults the professional hours and services', () => {
    expect(CreateSchedProfessionalSchema.parse({ name: 'Ana' })).toMatchObject({
      workingHours: {},
      serviceIds: [],
    })
    expect(
      UpdateSchedProfessionalSchema.safeParse({ active: false }).success,
    ).toBe(true)
  })
})

describe('appointment schemas', () => {
  it('requires ISO dates and defaults notify', () => {
    expect(
      CreateSchedAppointmentSchema.parse({
        serviceId: 's',
        professionalId: 'p',
        contactId: 'c',
        startsAt: '2026-11-04T12:00:00Z',
      }).notify,
    ).toBe(true)
    expect(
      CreateSchedAppointmentSchema.safeParse({
        serviceId: 's',
        professionalId: 'p',
        contactId: 'c',
        startsAt: 'amanhã',
      }).success,
    ).toBe(false)
  })

  it('parses the slot and list queries', () => {
    expect(
      SchedSlotsQuerySchema.parse({
        serviceId: 's',
        date: '2026-11-04',
        days: '3',
      }),
    ).toMatchObject({ days: 3 })
    expect(
      SchedSlotsQuerySchema.parse({ serviceId: 's', date: '2026-11-04' }).days,
    ).toBe(1)
    expect(
      SchedSlotsQuerySchema.safeParse({ serviceId: 's', date: '04/11/2026' })
        .success,
    ).toBe(false)
    expect(
      SchedAppointmentsQuerySchema.safeParse({
        from: '2026-11-01',
        to: '2026-11-30',
        status: 'NOPE',
      }).success,
    ).toBe(false)
  })

  it('refuses an empty appointment update', () => {
    expect(UpdateSchedAppointmentSchema.safeParse({}).success).toBe(false)
    expect(
      UpdateSchedAppointmentSchema.safeParse({ status: 'CANCELED' }).success,
    ).toBe(true)
    expect(
      UpdateSchedAppointmentSchema.safeParse({ status: 'PENDING' }).success,
    ).toBe(false)
  })
})
