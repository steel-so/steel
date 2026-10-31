import type {
  WhatsAppSchedService,
  WhatsAppSchedulingSettings,
} from '@prisma/client'
import type {
  SchedAppointmentFull,
  SchedProfessionalWithServices,
} from '@/src/repositories/whatsapp-scheduling.repository'
import type {
  WhatsAppSchedAppointmentDTO,
  WhatsAppSchedProfessionalDTO,
  WhatsAppSchedServiceDTO,
  WhatsAppSchedulingSettingsDTO,
  WhatsAppSchedWeeklyHoursDTO,
} from '@/types/whatsapp-scheduling'

export const SCHEDULING_SETTINGS_DEFAULTS = {
  enabled: false,
  connectionId: null,
  timezone: 'America/Sao_Paulo',
  slotMinutes: 30,
  minNoticeMinutes: 60,
  maxDaysAhead: 30,
  confirmationTemplateId: null,
  reminderTemplateId: null,
  reminderOffsets: [1440],
  bookingFlowId: null,
  ownerUserId: null,
} as const

export function toWhatsAppSchedulingSettingsDTO(
  workspaceId: string,
  row: WhatsAppSchedulingSettings | null,
): WhatsAppSchedulingSettingsDTO {
  if (!row) {
    return {
      workspaceId,
      ...SCHEDULING_SETTINGS_DEFAULTS,
      reminderOffsets: [...SCHEDULING_SETTINGS_DEFAULTS.reminderOffsets],
    }
  }
  return {
    workspaceId,
    enabled: row.enabled,
    connectionId: row.connectionId,
    timezone: row.timezone,
    slotMinutes: row.slotMinutes,
    minNoticeMinutes: row.minNoticeMinutes,
    maxDaysAhead: row.maxDaysAhead,
    confirmationTemplateId: row.confirmationTemplateId,
    reminderTemplateId: row.reminderTemplateId,
    reminderOffsets: row.reminderOffsets,
    bookingFlowId: row.bookingFlowId,
    ownerUserId: row.ownerUserId,
  }
}

export function toWhatsAppSchedServiceDTO(
  row: WhatsAppSchedService,
): WhatsAppSchedServiceDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    durationMinutes: row.durationMinutes,
    bufferMinutes: row.bufferMinutes,
    active: row.active,
  }
}

export function toWhatsAppSchedProfessionalDTO(
  row: SchedProfessionalWithServices,
): WhatsAppSchedProfessionalDTO {
  const hours =
    typeof row.workingHours === 'object' &&
    row.workingHours !== null &&
    !Array.isArray(row.workingHours)
      ? (row.workingHours as WhatsAppSchedWeeklyHoursDTO)
      : {}
  return {
    id: row.id,
    name: row.name,
    userId: row.userId,
    active: row.active,
    workingHours: hours,
    serviceIds: row.services.map((s) => s.serviceId),
  }
}

export function toWhatsAppSchedAppointmentDTO(
  row: SchedAppointmentFull,
): WhatsAppSchedAppointmentDTO {
  return {
    id: row.id,
    serviceId: row.serviceId,
    serviceName: row.service.name,
    professionalId: row.professionalId,
    professionalName: row.professional.name,
    contactId: row.contactId,
    contactName: row.contact.name,
    contactWaId: row.contact.waId,
    conversationId: row.conversationId,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    status: row.status,
    source: row.source,
    notes: row.notes,
    confirmationSentAt: row.confirmationSentAt?.toISOString() ?? null,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    canceledAt: row.canceledAt?.toISOString() ?? null,
    cancelReason: row.cancelReason,
    createdAt: row.createdAt.toISOString(),
  }
}
