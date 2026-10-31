export type WhatsAppSchedAppointmentStatusDTO =
  | 'PENDING'
  | 'CONFIRMED'
  | 'CANCELED'
  | 'COMPLETED'
  | 'NO_SHOW'
export type WhatsAppSchedAppointmentSourceDTO = 'AGENT' | 'FLOW' | 'CONTACT'

export interface WhatsAppSchedWindowDTO {
  start: string
  end: string
}

/** Weekday (`"0"` = Sunday) -> working windows. */
export type WhatsAppSchedWeeklyHoursDTO = Record<
  string,
  WhatsAppSchedWindowDTO[]
>

export interface WhatsAppSchedulingSettingsDTO {
  workspaceId: string
  enabled: boolean
  connectionId: string | null
  timezone: string
  slotMinutes: number
  minNoticeMinutes: number
  maxDaysAhead: number
  confirmationTemplateId: string | null
  reminderTemplateId: string | null
  reminderOffsets: number[]
  bookingFlowId: string | null
  ownerUserId: string | null
}

export interface WhatsAppSchedServiceDTO {
  id: string
  name: string
  description: string | null
  durationMinutes: number
  bufferMinutes: number
  active: boolean
}

export interface WhatsAppSchedProfessionalDTO {
  id: string
  name: string
  userId: string | null
  active: boolean
  workingHours: WhatsAppSchedWeeklyHoursDTO
  serviceIds: string[]
}

export interface WhatsAppSchedAppointmentDTO {
  id: string
  serviceId: string
  serviceName: string
  professionalId: string
  professionalName: string
  contactId: string
  contactName: string | null
  contactWaId: string
  conversationId: string | null
  startsAt: string
  endsAt: string
  status: WhatsAppSchedAppointmentStatusDTO
  source: WhatsAppSchedAppointmentSourceDTO
  notes: string | null
  confirmationSentAt: string | null
  confirmedAt: string | null
  canceledAt: string | null
  cancelReason: string | null
  createdAt: string
}

export interface WhatsAppSchedSlotDTO {
  startsAt: string
  professionalId: string
  professionalName: string
}
