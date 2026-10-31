import { createId } from '@paralleldrive/cuid2'
import type {
  WhatsAppContact,
  WhatsAppSchedAppointment,
  WhatsAppSchedProfessional,
  WhatsAppSchedService,
  WhatsAppSchedulingSettings,
} from '@prisma/client'
import { Prisma } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type {
  SchedAppointmentFull,
  SchedProfessionalWithServices,
} from '@/src/repositories/whatsapp-scheduling.repository'

const now = () => new Date()

export function createFakeSchedulingSettings(
  overrides?: Partial<WhatsAppSchedulingSettings>,
): WhatsAppSchedulingSettings {
  return {
    id: createId(),
    workspaceId: createId(),
    enabled: true,
    connectionId: createId(),
    timezone: 'America/Sao_Paulo',
    slotMinutes: 30,
    minNoticeMinutes: 60,
    maxDaysAhead: 30,
    confirmationTemplateId: createId(),
    reminderTemplateId: createId(),
    reminderOffsets: [1440],
    bookingFlowId: null,
    ownerUserId: createId(),
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  }
}

export function createFakeSchedService(
  overrides?: Partial<WhatsAppSchedService>,
): WhatsAppSchedService {
  return {
    id: createId(),
    workspaceId: createId(),
    name: 'Corte de cabelo',
    description: null,
    durationMinutes: 30,
    bufferMinutes: 0,
    active: true,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  }
}

export const WEEKDAY_HOURS = Object.fromEntries(
  ['1', '2', '3', '4', '5'].map((day) => [
    day,
    [{ start: '09:00', end: '17:00' }],
  ]),
)

export function createFakeSchedProfessional(
  overrides?: Partial<SchedProfessionalWithServices>,
): SchedProfessionalWithServices {
  return {
    id: createId(),
    workspaceId: createId(),
    name: 'Ana',
    userId: null,
    active: true,
    workingHours:
      WEEKDAY_HOURS as unknown as WhatsAppSchedProfessional['workingHours'],
    createdAt: now(),
    updatedAt: now(),
    services: [],
    ...overrides,
  }
}

export function createFakeSchedAppointment(
  overrides?: Partial<WhatsAppSchedAppointment>,
): WhatsAppSchedAppointment {
  const startsAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
  return {
    id: createId(),
    workspaceId: createId(),
    serviceId: createId(),
    professionalId: createId(),
    contactId: createId(),
    conversationId: null,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 30 * 60 * 1000),
    status: 'PENDING',
    source: 'AGENT',
    notes: null,
    createdById: null,
    confirmationSentAt: null,
    confirmedAt: null,
    canceledAt: null,
    cancelReason: null,
    remindersSent: [],
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  }
}

export function createFakeSchedAppointmentFull(
  overrides?: Partial<SchedAppointmentFull>,
): SchedAppointmentFull {
  const workspaceId = overrides?.workspaceId ?? createId()
  const service = overrides?.service ?? createFakeSchedService({ workspaceId })
  const professional =
    overrides?.professional ?? createFakeSchedProfessional({ workspaceId })
  const contact: WhatsAppContact =
    overrides?.contact ??
    ({
      id: createId(),
      workspaceId,
      waId: '5511988887777',
      bsuid: null,
      username: null,
      name: 'Maria Souza',
      avatarUrl: null,
      description: null,
      broadcastOptedOutAt: null,
      broadcastOptOutSource: null,
      hasWhatsapp: null,
      whatsappCheckedAt: null,
      whatsappLid: null,
      createdAt: now(),
      updatedAt: now(),
    } as WhatsAppContact)
  return {
    ...createFakeSchedAppointment({
      workspaceId,
      serviceId: service.id,
      professionalId: professional.id,
      contactId: contact.id,
    }),
    service,
    professional,
    contact,
    ...overrides,
  }
}

/** Workspace + user + connection + contact rows for integration tests. */
export async function seedSchedulingFixtures(workspaceId: string, userId: string) {
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId,
      provider: 'META',
      module: 'COMMUNICATION',
      label: 'Agenda',
      phoneNumber: `55119${Math.floor(Math.random() * 1e8)}`,
      status: 'CONNECTED',
      metaPhoneNumberId: 'phone1',
      metaWabaId: 'waba1',
      createdById: userId,
    },
  })
  const contact = await prisma.whatsAppContact.create({
    data: {
      workspaceId,
      waId: `55119${Math.floor(Math.random() * 1e8)}`,
      name: 'Maria',
    },
  })
  return { connection, contact }
}
