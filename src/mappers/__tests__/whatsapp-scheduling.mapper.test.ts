import { describe, expect, it } from 'vitest'
import type {
  SchedAppointmentFull,
  SchedProfessionalWithServices,
} from '@/src/repositories/whatsapp-scheduling.repository'
import {
  SCHEDULING_SETTINGS_DEFAULTS,
  toWhatsAppSchedAppointmentDTO,
  toWhatsAppSchedProfessionalDTO,
  toWhatsAppSchedServiceDTO,
  toWhatsAppSchedulingSettingsDTO,
} from '../whatsapp-scheduling.mapper'

const now = new Date('2026-11-04T12:00:00Z')

describe('scheduling mappers', () => {
  it('returns defaults and a fresh offsets array', () => {
    const a = toWhatsAppSchedulingSettingsDTO('ws', null)
    expect(a).toMatchObject({ enabled: false, timezone: 'America/Sao_Paulo' })
    a.reminderOffsets.push(1)
    expect(SCHEDULING_SETTINGS_DEFAULTS.reminderOffsets).toEqual([1440])
  })

  it('maps saved settings', () => {
    expect(
      toWhatsAppSchedulingSettingsDTO('ws', {
        id: 's',
        workspaceId: 'ws',
        enabled: true,
        connectionId: 'c',
        timezone: 'America/Manaus',
        slotMinutes: 15,
        minNoticeMinutes: 30,
        maxDaysAhead: 10,
        confirmationTemplateId: 't1',
        reminderTemplateId: 't2',
        reminderOffsets: [120],
        bookingFlowId: 'f',
        ownerUserId: 'u',
        createdAt: now,
        updatedAt: now,
      }),
    ).toMatchObject({
      enabled: true,
      timezone: 'America/Manaus',
      reminderOffsets: [120],
    })
  })

  it('maps services and professionals', () => {
    expect(
      toWhatsAppSchedServiceDTO({
        id: 's',
        workspaceId: 'ws',
        name: 'Corte',
        description: null,
        durationMinutes: 30,
        bufferMinutes: 5,
        active: true,
        createdAt: now,
        updatedAt: now,
      }),
    ).toEqual({
      id: 's',
      name: 'Corte',
      description: null,
      durationMinutes: 30,
      bufferMinutes: 5,
      active: true,
    })

    const professional = {
      id: 'p',
      workspaceId: 'ws',
      name: 'Ana',
      userId: null,
      active: true,
      workingHours: { '1': [{ start: '09:00', end: '12:00' }] },
      createdAt: now,
      updatedAt: now,
      services: [{ serviceId: 's' }],
    } as SchedProfessionalWithServices
    expect(toWhatsAppSchedProfessionalDTO(professional)).toMatchObject({
      workingHours: { '1': [{ start: '09:00', end: '12:00' }] },
      serviceIds: ['s'],
    })
    expect(
      toWhatsAppSchedProfessionalDTO({ ...professional, workingHours: [] })
        .workingHours,
    ).toEqual({})
    expect(
      toWhatsAppSchedProfessionalDTO({ ...professional, workingHours: null })
        .workingHours,
    ).toEqual({})
  })

  it('maps appointments', () => {
    const row = {
      id: 'a',
      workspaceId: 'ws',
      serviceId: 's',
      professionalId: 'p',
      contactId: 'c',
      conversationId: null,
      startsAt: now,
      endsAt: new Date(now.getTime() + 1_800_000),
      status: 'CONFIRMED',
      source: 'FLOW',
      notes: null,
      createdById: null,
      confirmationSentAt: now,
      confirmedAt: now,
      canceledAt: null,
      cancelReason: null,
      remindersSent: [],
      createdAt: now,
      updatedAt: now,
      service: { name: 'Corte' },
      professional: { name: 'Ana' },
      contact: { name: 'Maria', waId: '5511' },
    } as unknown as SchedAppointmentFull
    expect(toWhatsAppSchedAppointmentDTO(row)).toMatchObject({
      serviceName: 'Corte',
      professionalName: 'Ana',
      contactName: 'Maria',
      status: 'CONFIRMED',
      confirmedAt: now.toISOString(),
      canceledAt: null,
    })
    expect(
      toWhatsAppSchedAppointmentDTO({
        ...row,
        confirmationSentAt: null,
        confirmedAt: null,
      }).confirmedAt,
    ).toBeNull()
  })
})
