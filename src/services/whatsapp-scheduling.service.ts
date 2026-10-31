import type {
  Prisma,
  WhatsAppContact,
  WhatsAppSchedService,
  WhatsAppSchedulingSettings,
} from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  notFound,
  whatsappConnectionNotFound,
  whatsappSchedDisabled,
  whatsappSchedInvalid,
  whatsappSchedProfessionalNotFound,
  whatsappSchedServiceNotFound,
  whatsappSchedSlotTaken,
  whatsappSchedStateConflict,
  whatsappTemplateNotFound,
} from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import { stripUndefined } from '@/src/lib/strip-undefined'
import { dueReminder } from '@/src/lib/whatsapp/scheduling/replies'
import {
  type BusyRange,
  computeSlots,
  dateKeysFrom,
  periodOf,
  type WeeklyHours,
} from '@/src/lib/whatsapp/scheduling/slots'
import {
  addDaysToDateKey,
  formatAppointmentDate,
  zonedDateKey,
  zonedToUtc,
} from '@/src/lib/whatsapp/scheduling/time'
import {
  toWhatsAppSchedAppointmentDTO,
  toWhatsAppSchedProfessionalDTO,
  toWhatsAppSchedServiceDTO,
  toWhatsAppSchedulingSettingsDTO,
} from '@/src/mappers/whatsapp-scheduling.mapper'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppFlowRepository } from '@/src/repositories/whatsapp-flow.repository'
import {
  type SchedAppointmentFull,
  type SchedProfessionalWithServices,
  WhatsAppSchedAppointmentRepository,
  WhatsAppSchedProfessionalRepository,
  WhatsAppSchedServiceRepository,
  WhatsAppSchedulingSettingsRepository,
} from '@/src/repositories/whatsapp-scheduling.repository'
import { WhatsAppTemplateRepository } from '@/src/repositories/whatsapp-template.repository'
import type {
  CreateSchedAppointmentDTO,
  CreateSchedProfessionalDTO,
  CreateSchedServiceDTO,
  SchedAppointmentsQueryDTO,
  SchedSlotsQueryDTO,
  UpdateSchedAppointmentDTO,
  UpdateSchedProfessionalDTO,
  UpdateSchedServiceDTO,
  UpdateSchedulingSettingsDTO,
} from '@/src/schemas/whatsapp-scheduling.schema'
import type {
  WhatsAppSchedAppointmentDTO,
  WhatsAppSchedProfessionalDTO,
  WhatsAppSchedServiceDTO,
  WhatsAppSchedSlotDTO,
  WhatsAppSchedulingSettingsDTO,
} from '@/types/whatsapp-scheduling'
import { assertModuleMember, assertModulePrivileged } from './authz'
import { sendAutomationTemplate } from './whatsapp-automation-send.service'

const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS
/** Appointments a tick looks at at most. */
const TICK_BATCH = 200

export interface SchedulingTickResult {
  confirmations: number
  reminders: number
  failed: number
}

/** Settings of a workspace where scheduling is on, or `SCHED_DISABLED`. */
async function requireEnabled(
  workspaceId: string,
): Promise<Result<WhatsAppSchedulingSettings>> {
  const settings =
    await WhatsAppSchedulingSettingsRepository.findByWorkspace(workspaceId)
  if (!settings.ok) return settings
  if (!settings.value?.enabled) return err(whatsappSchedDisabled())
  return ok(settings.value)
}

async function loadService(
  workspaceId: string,
  serviceId: string,
): Promise<Result<WhatsAppSchedService>> {
  const found = await WhatsAppSchedServiceRepository.findById(
    serviceId,
    workspaceId,
  )
  if (!found.ok) return found
  if (!found.value) return err(whatsappSchedServiceNotFound())
  return ok(found.value)
}

async function loadProfessional(
  workspaceId: string,
  professionalId: string,
): Promise<Result<SchedProfessionalWithServices>> {
  const found = await WhatsAppSchedProfessionalRepository.findById(
    professionalId,
    workspaceId,
  )
  if (!found.ok) return found
  if (!found.value) return err(whatsappSchedProfessionalNotFound())
  return ok(found.value)
}

async function assertServicesExist(
  workspaceId: string,
  serviceIds: string[],
): Promise<Result<void>> {
  if (serviceIds.length === 0) return ok(undefined)
  const services = await WhatsAppSchedServiceRepository.list(workspaceId)
  if (!services.ok) return services
  const known = new Set(services.value.map((s) => s.id))
  if (serviceIds.some((id) => !known.has(id))) {
    return err(whatsappSchedServiceNotFound())
  }
  return ok(undefined)
}

function hoursOf(professional: SchedProfessionalWithServices): WeeklyHours {
  const value = professional.workingHours
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as WeeklyHours)
    : {}
}

interface AvailabilityInput {
  workspaceId: string
  settings: WhatsAppSchedulingSettings
  service: WhatsAppSchedService
  professionals: SchedProfessionalWithServices[]
  dateKeys: string[]
  now: Date
}

/** Free starts per professional on the given days. */
async function availability(
  input: AvailabilityInput,
): Promise<
  Result<{ professional: SchedProfessionalWithServices; starts: Date[] }[]>
> {
  const { settings, service, professionals, dateKeys, now } = input
  if (professionals.length === 0 || dateKeys.length === 0) return ok([])
  const from = zonedToUtc(dateKeys[0], 0, settings.timezone)
  const to = zonedToUtc(
    addDaysToDateKey(dateKeys[dateKeys.length - 1], 1),
    0,
    settings.timezone,
  )
  const busyRows = await WhatsAppSchedAppointmentRepository.listBusy(
    professionals.map((p) => p.id),
    new Date(from.getTime() - DAY_MS),
    to,
  )
  if (!busyRows.ok) return busyRows

  return ok(
    professionals.map((professional) => {
      const busy: BusyRange[] = busyRows.value
        .filter((row) => row.professionalId === professional.id)
        .map((row) => ({
          startsAt: row.startsAt,
          endsAt: new Date(
            row.endsAt.getTime() + row.service.bufferMinutes * MINUTE_MS,
          ),
        }))
      const starts = dateKeys.flatMap((dateKey) =>
        computeSlots({
          dateKey,
          timeZone: settings.timezone,
          hours: hoursOf(professional),
          durationMinutes: service.durationMinutes,
          bufferMinutes: service.bufferMinutes,
          stepMinutes: settings.slotMinutes,
          busy,
          now,
          minNoticeMinutes: settings.minNoticeMinutes,
        }),
      )
      return { professional, starts }
    }),
  )
}

/** First and last bookable day: today up to `maxDaysAhead` days. */
function bookableRange(settings: WhatsAppSchedulingSettings, now: Date) {
  const today = zonedDateKey(now, settings.timezone)
  return { today, last: addDaysToDateKey(today, settings.maxDaysAhead) }
}

interface BookInput {
  workspaceId: string
  settings: WhatsAppSchedulingSettings
  service: WhatsAppSchedService
  professional: SchedProfessionalWithServices
  contact: WhatsAppContact
  conversationId?: string | null
  startsAt: Date
  source: 'AGENT' | 'FLOW' | 'CONTACT'
  notes?: string | null
  createdById?: string | null
  notify: boolean
  now: Date
}

/** Validates the slot, books it and (optionally) sends the confirmation. */
async function book(input: BookInput): Promise<Result<SchedAppointmentFull>> {
  const { settings, service, professional, now } = input
  if (!service.active || !professional.active) {
    return err(whatsappSchedInvalid('Serviço ou profissional desativado'))
  }
  if (!professional.services.some((s) => s.serviceId === service.id)) {
    return err(
      whatsappSchedInvalid('Este profissional não atende o serviço escolhido'),
    )
  }
  const { today, last } = bookableRange(settings, now)
  const dateKey = zonedDateKey(input.startsAt, settings.timezone)
  if (dateKey < today || dateKey > last) {
    return err(
      whatsappSchedInvalid('A data está fora do período de agendamento'),
    )
  }
  const free = await availability({
    workspaceId: input.workspaceId,
    settings,
    service,
    professionals: [professional],
    dateKeys: [dateKey],
    now,
  })
  if (!free.ok) return free
  const offered = free.value[0].starts.some(
    (start) => start.getTime() === input.startsAt.getTime(),
  )
  if (!offered) return err(whatsappSchedSlotTaken())

  const created = await WhatsAppSchedAppointmentRepository.createIfFree({
    workspaceId: input.workspaceId,
    serviceId: service.id,
    professionalId: professional.id,
    contactId: input.contact.id,
    conversationId: input.conversationId ?? null,
    startsAt: input.startsAt,
    endsAt: new Date(
      input.startsAt.getTime() + service.durationMinutes * MINUTE_MS,
    ),
    bufferMinutes: service.bufferMinutes,
    source: input.source,
    notes: input.notes ?? null,
    createdById: input.createdById ?? null,
  })
  if (!created.ok) return created

  auditMutation({
    entity: 'whatsapp_sched_appointment',
    action: 'create',
    actorId: input.createdById ?? null,
    targetId: created.value.id,
    meta: {
      workspaceId: input.workspaceId,
      source: input.source,
      serviceId: service.id,
      professionalId: professional.id,
    },
  })
  if (input.notify) await sendConfirmation(created.value, settings)
  return ok(created.value)
}

function firstName(contact: WhatsAppContact): string {
  return contact.name?.trim().split(/\s+/)[0] || 'cliente'
}

function messageVariables(
  appointment: SchedAppointmentFull,
  settings: WhatsAppSchedulingSettings,
): string[] {
  return [
    firstName(appointment.contact),
    appointment.service.name,
    formatAppointmentDate(appointment.startsAt, settings.timezone),
    appointment.professional.name,
  ]
}

/** Sends the confirmation template once; a failure hands the right back. */
async function sendConfirmation(
  appointment: SchedAppointmentFull,
  settings: WhatsAppSchedulingSettings,
): Promise<boolean> {
  if (!settings.connectionId || !settings.confirmationTemplateId) return false
  const claimed = await WhatsAppSchedAppointmentRepository.claimConfirmation(
    appointment.id,
    new Date(),
  )
  if (!claimed.ok || !claimed.value) return false
  const sent = await sendAutomationTemplate({
    workspaceId: appointment.workspaceId,
    connectionId: settings.connectionId,
    templateId: settings.confirmationTemplateId,
    waId: appointment.contact.waId,
    contactName: appointment.contact.name,
    variables: messageVariables(appointment, settings),
    // A booking notice is transactional: the contact asked for it.
    ignoreOptOut: true,
  })
  if (sent.ok && sent.value.kind === 'sent') return true
  await WhatsAppSchedAppointmentRepository.releaseConfirmation(appointment.id)
  logger.warn('whatsapp.scheduling.confirmation_failed', {
    workspaceId: appointment.workspaceId,
    appointmentId: appointment.id,
    reason: sent.ok ? sent.value.kind : sent.error.code,
  })
  return false
}

async function authorizeAgenda(
  actorId: string,
  workspaceId: string,
  action: 'VIEW' | 'CREATE' | 'EDIT',
) {
  return assertModuleMember(actorId, workspaceId, 'COMMUNICATION', {
    resource: 'conversations',
    action,
  })
}

export const WhatsAppSchedulingService = {
  async getSettings(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppSchedulingSettingsDTO>> {
    const member = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!member.ok) return member
    const row =
      await WhatsAppSchedulingSettingsRepository.findByWorkspace(workspaceId)
    if (!row.ok) return row
    return ok(toWhatsAppSchedulingSettingsDTO(workspaceId, row.value))
  },

  async updateSettings(
    actorId: string,
    workspaceId: string,
    dto: UpdateSchedulingSettingsDTO,
  ): Promise<Result<WhatsAppSchedulingSettingsDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged

    const existing =
      await WhatsAppSchedulingSettingsRepository.findByWorkspace(workspaceId)
    if (!existing.ok) return existing
    const next = {
      ...toWhatsAppSchedulingSettingsDTO(workspaceId, existing.value),
      ...stripUndefined(dto),
    }

    if (next.enabled && !next.connectionId) {
      return err(
        whatsappSchedInvalid('Escolha a conexão do WhatsApp antes de ativar'),
      )
    }
    if (dto.connectionId) {
      const connection = await WhatsAppConnectionRepository.findById(
        dto.connectionId,
        workspaceId,
      )
      if (!connection.ok) return connection
      if (connection.value?.module !== 'COMMUNICATION') {
        return err(whatsappConnectionNotFound())
      }
    }
    for (const templateId of [
      dto.confirmationTemplateId,
      dto.reminderTemplateId,
    ]) {
      if (!templateId) continue
      const template = await WhatsAppTemplateRepository.findById(
        templateId,
        workspaceId,
      )
      if (!template.ok) return template
      if (!template.value) return err(whatsappTemplateNotFound())
    }
    if (dto.bookingFlowId) {
      const flow = await WhatsAppFlowRepository.findById(
        dto.bookingFlowId,
        workspaceId,
      )
      if (!flow.ok) return flow
      if (!flow.value) return err(notFound('WhatsAppFlow'))
    }

    const saved = await WhatsAppSchedulingSettingsRepository.upsert(
      workspaceId,
      {
        ...stripUndefined(dto),
        ...(existing.value?.ownerUserId ? {} : { ownerUserId: actorId }),
      },
    )
    if (!saved.ok) return saved
    auditMutation({
      entity: 'whatsapp_scheduling_settings',
      action: 'update',
      actorId,
      targetId: saved.value.id,
      meta: { workspaceId, ...dto },
    })
    return ok(toWhatsAppSchedulingSettingsDTO(workspaceId, saved.value))
  },

  // ─── services ─────────────────────────────────────────────────────────────

  async listServices(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppSchedServiceDTO[]>> {
    const member = await authorizeAgenda(actorId, workspaceId, 'VIEW')
    if (!member.ok) return member
    const rows = await WhatsAppSchedServiceRepository.list(workspaceId)
    if (!rows.ok) return rows
    return ok(rows.value.map(toWhatsAppSchedServiceDTO))
  },

  async createService(
    actorId: string,
    workspaceId: string,
    dto: CreateSchedServiceDTO,
  ): Promise<Result<WhatsAppSchedServiceDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged
    const created = await WhatsAppSchedServiceRepository.create({
      workspaceId,
      name: dto.name,
      description: dto.description ?? null,
      durationMinutes: dto.durationMinutes,
      bufferMinutes: dto.bufferMinutes,
    })
    if (!created.ok) return created
    auditMutation({
      entity: 'whatsapp_sched_service',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { workspaceId },
    })
    return ok(toWhatsAppSchedServiceDTO(created.value))
  },

  async updateService(
    actorId: string,
    workspaceId: string,
    serviceId: string,
    dto: UpdateSchedServiceDTO,
  ): Promise<Result<WhatsAppSchedServiceDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged
    const service = await loadService(workspaceId, serviceId)
    if (!service.ok) return service
    const updated = await WhatsAppSchedServiceRepository.update(
      serviceId,
      stripUndefined(dto),
    )
    if (!updated.ok) return updated
    auditMutation({
      entity: 'whatsapp_sched_service',
      action: 'update',
      actorId,
      targetId: serviceId,
      meta: { workspaceId, ...dto },
    })
    return ok(toWhatsAppSchedServiceDTO(updated.value))
  },

  async deleteService(
    actorId: string,
    workspaceId: string,
    serviceId: string,
  ): Promise<Result<void>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged
    const service = await loadService(workspaceId, serviceId)
    if (!service.ok) return service
    const used =
      await WhatsAppSchedServiceRepository.countAppointments(serviceId)
    if (!used.ok) return used
    if (used.value > 0) {
      return err(
        whatsappSchedStateConflict(
          'O serviço já tem agendamentos. Desative-o em vez de excluir.',
        ),
      )
    }
    const deleted = await WhatsAppSchedServiceRepository.delete(serviceId)
    if (!deleted.ok) return deleted
    auditMutation({
      entity: 'whatsapp_sched_service',
      action: 'delete',
      actorId,
      targetId: serviceId,
      meta: { workspaceId },
    })
    return ok(undefined)
  },

  // ─── professionals ────────────────────────────────────────────────────────

  async listProfessionals(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppSchedProfessionalDTO[]>> {
    const member = await authorizeAgenda(actorId, workspaceId, 'VIEW')
    if (!member.ok) return member
    const rows = await WhatsAppSchedProfessionalRepository.list(workspaceId)
    if (!rows.ok) return rows
    return ok(rows.value.map(toWhatsAppSchedProfessionalDTO))
  },

  async createProfessional(
    actorId: string,
    workspaceId: string,
    dto: CreateSchedProfessionalDTO,
  ): Promise<Result<WhatsAppSchedProfessionalDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged
    const known = await assertServicesExist(workspaceId, dto.serviceIds)
    if (!known.ok) return known
    const created = await WhatsAppSchedProfessionalRepository.create(
      {
        workspaceId,
        name: dto.name,
        userId: dto.userId ?? null,
        workingHours: dto.workingHours as Prisma.InputJsonValue,
      },
      dto.serviceIds,
    )
    if (!created.ok) return created
    auditMutation({
      entity: 'whatsapp_sched_professional',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { workspaceId },
    })
    return ok(toWhatsAppSchedProfessionalDTO(created.value))
  },

  async updateProfessional(
    actorId: string,
    workspaceId: string,
    professionalId: string,
    dto: UpdateSchedProfessionalDTO,
  ): Promise<Result<WhatsAppSchedProfessionalDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged
    const professional = await loadProfessional(workspaceId, professionalId)
    if (!professional.ok) return professional
    if (dto.serviceIds) {
      const known = await assertServicesExist(workspaceId, dto.serviceIds)
      if (!known.ok) return known
    }
    const { serviceIds, workingHours, ...rest } = dto
    const updated = await WhatsAppSchedProfessionalRepository.update(
      professionalId,
      {
        ...stripUndefined(rest),
        ...(workingHours
          ? { workingHours: workingHours as Prisma.InputJsonValue }
          : {}),
      },
      serviceIds,
    )
    if (!updated.ok) return updated
    auditMutation({
      entity: 'whatsapp_sched_professional',
      action: 'update',
      actorId,
      targetId: professionalId,
      meta: { workspaceId, fields: Object.keys(dto) },
    })
    return ok(toWhatsAppSchedProfessionalDTO(updated.value))
  },

  async deleteProfessional(
    actorId: string,
    workspaceId: string,
    professionalId: string,
  ): Promise<Result<void>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged
    const professional = await loadProfessional(workspaceId, professionalId)
    if (!professional.ok) return professional
    const used =
      await WhatsAppSchedProfessionalRepository.countAppointments(
        professionalId,
      )
    if (!used.ok) return used
    if (used.value > 0) {
      return err(
        whatsappSchedStateConflict(
          'O profissional já tem agendamentos. Desative-o em vez de excluir.',
        ),
      )
    }
    const deleted =
      await WhatsAppSchedProfessionalRepository.delete(professionalId)
    if (!deleted.ok) return deleted
    auditMutation({
      entity: 'whatsapp_sched_professional',
      action: 'delete',
      actorId,
      targetId: professionalId,
      meta: { workspaceId },
    })
    return ok(undefined)
  },

  // ─── slots and appointments ───────────────────────────────────────────────

  async listSlots(
    actorId: string,
    workspaceId: string,
    query: SchedSlotsQueryDTO,
    now: Date = new Date(),
  ): Promise<Result<WhatsAppSchedSlotDTO[]>> {
    const member = await authorizeAgenda(actorId, workspaceId, 'VIEW')
    if (!member.ok) return member
    const settings = await requireEnabled(workspaceId)
    if (!settings.ok) return settings
    const service = await loadService(workspaceId, query.serviceId)
    if (!service.ok) return service

    const professionals = query.professionalId
      ? await loadProfessional(workspaceId, query.professionalId).then((r) =>
          r.ok ? ok([r.value]) : r,
        )
      : await WhatsAppSchedProfessionalRepository.listForService(
          workspaceId,
          service.value.id,
        )
    if (!professionals.ok) return professionals
    const eligible = professionals.value.filter(
      (p) =>
        p.active && p.services.some((s) => s.serviceId === service.value.id),
    )

    const { today, last } = bookableRange(settings.value, now)
    const dateKeys = dateKeysFrom(query.date, query.days).filter(
      (key) => key >= today && key <= last,
    )
    const free = await availability({
      workspaceId,
      settings: settings.value,
      service: service.value,
      professionals: eligible,
      dateKeys,
      now,
    })
    if (!free.ok) return free
    return ok(
      free.value
        .flatMap(({ professional, starts }) =>
          starts.map((start) => ({
            startsAt: start.toISOString(),
            professionalId: professional.id,
            professionalName: professional.name,
          })),
        )
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    )
  },

  async listAppointments(
    actorId: string,
    workspaceId: string,
    query: SchedAppointmentsQueryDTO,
  ): Promise<Result<WhatsAppSchedAppointmentDTO[]>> {
    const member = await authorizeAgenda(actorId, workspaceId, 'VIEW')
    if (!member.ok) return member
    const settings =
      await WhatsAppSchedulingSettingsRepository.findByWorkspace(workspaceId)
    if (!settings.ok) return settings
    const timeZone = settings.value?.timezone ?? 'America/Sao_Paulo'
    const rows = await WhatsAppSchedAppointmentRepository.list(workspaceId, {
      from: zonedToUtc(query.from, 0, timeZone),
      to: zonedToUtc(addDaysToDateKey(query.to, 1), 0, timeZone),
      professionalId: query.professionalId,
      status: query.status,
    })
    if (!rows.ok) return rows
    return ok(rows.value.map(toWhatsAppSchedAppointmentDTO))
  },

  async createAppointment(
    actorId: string,
    workspaceId: string,
    dto: CreateSchedAppointmentDTO,
    now: Date = new Date(),
  ): Promise<Result<WhatsAppSchedAppointmentDTO>> {
    const member = await authorizeAgenda(actorId, workspaceId, 'CREATE')
    if (!member.ok) return member
    const settings = await requireEnabled(workspaceId)
    if (!settings.ok) return settings
    const [service, professional, contact] = await Promise.all([
      loadService(workspaceId, dto.serviceId),
      loadProfessional(workspaceId, dto.professionalId),
      WhatsAppContactRepository.findById(dto.contactId, workspaceId),
    ])
    if (!service.ok) return service
    if (!professional.ok) return professional
    if (!contact.ok) return contact
    if (!contact.value) return err(notFound('WhatsAppContact'))

    const created = await book({
      workspaceId,
      settings: settings.value,
      service: service.value,
      professional: professional.value,
      contact: contact.value,
      conversationId: dto.conversationId,
      startsAt: new Date(dto.startsAt),
      source: 'AGENT',
      notes: dto.notes,
      createdById: actorId,
      notify: dto.notify,
      now,
    })
    if (!created.ok) return created
    // The confirmation may have stamped the row after it was read.
    const fresh = await WhatsAppSchedAppointmentRepository.findById(
      created.value.id,
      workspaceId,
    )
    return ok(
      toWhatsAppSchedAppointmentDTO(
        fresh.ok && fresh.value ? fresh.value : created.value,
      ),
    )
  },

  async updateAppointment(
    actorId: string,
    workspaceId: string,
    appointmentId: string,
    dto: UpdateSchedAppointmentDTO,
    now: Date = new Date(),
  ): Promise<Result<WhatsAppSchedAppointmentDTO>> {
    const member = await authorizeAgenda(actorId, workspaceId, 'EDIT')
    if (!member.ok) return member
    const found = await WhatsAppSchedAppointmentRepository.findById(
      appointmentId,
      workspaceId,
    )
    if (!found.ok) return found
    if (!found.value) {
      return err(notFound('WhatsAppSchedAppointment'))
    }
    const appointment = found.value
    const live =
      appointment.status === 'PENDING' || appointment.status === 'CONFIRMED'
    if (!live) {
      return err(
        whatsappSchedStateConflict('Este agendamento já foi encerrado'),
      )
    }

    // Moving frees the old slot first (it may overlap the new one) and puts
    // the appointment back if the new slot is refused.
    if (dto.startsAt || dto.professionalId) {
      const settings = await requireEnabled(workspaceId)
      if (!settings.ok) return settings
      const professional = await loadProfessional(
        workspaceId,
        dto.professionalId ?? appointment.professionalId,
      )
      if (!professional.ok) return professional
      const released = await WhatsAppSchedAppointmentRepository.update(
        appointment.id,
        { status: 'CANCELED', canceledAt: now, cancelReason: 'Remarcado' },
      )
      if (!released.ok) return released
      const moved = await book({
        workspaceId,
        settings: settings.value,
        service: appointment.service,
        professional: professional.value,
        contact: appointment.contact,
        conversationId: appointment.conversationId,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : appointment.startsAt,
        source: 'AGENT',
        notes: dto.notes === undefined ? appointment.notes : dto.notes,
        createdById: actorId,
        notify: true,
        now,
      })
      if (!moved.ok) {
        await WhatsAppSchedAppointmentRepository.update(appointment.id, {
          status: appointment.status,
          canceledAt: null,
          cancelReason: null,
        })
        return moved
      }
      auditMutation({
        entity: 'whatsapp_sched_appointment',
        action: 'move',
        actorId,
        targetId: appointment.id,
        meta: { workspaceId, newAppointmentId: moved.value.id },
      })
      return ok(toWhatsAppSchedAppointmentDTO(moved.value))
    }

    const data: Prisma.WhatsAppSchedAppointmentUncheckedUpdateInput = {}
    if (dto.notes !== undefined) data.notes = dto.notes
    if (dto.status === 'CONFIRMED') {
      data.status = 'CONFIRMED'
      data.confirmedAt = now
    } else if (dto.status === 'CANCELED') {
      data.status = 'CANCELED'
      data.canceledAt = now
      data.cancelReason = dto.reason ?? null
    } else if (dto.status) {
      if (appointment.startsAt > now) {
        return err(
          whatsappSchedStateConflict(
            'Só dá para concluir ou marcar falta depois do horário',
          ),
        )
      }
      data.status = dto.status
    }
    const updated = await WhatsAppSchedAppointmentRepository.update(
      appointment.id,
      data,
    )
    if (!updated.ok) return updated
    auditMutation({
      entity: 'whatsapp_sched_appointment',
      action: 'update',
      actorId,
      targetId: appointment.id,
      meta: { workspaceId, status: dto.status ?? null },
    })
    return ok(toWhatsAppSchedAppointmentDTO(updated.value))
  },

  /**
   * Books from the answers of the booking Flow (Z3): service (option id or
   * title), day and period. Picks the earliest free start of that period
   * among the professionals who offer the service. The text is what the
   * contact reads back (it replaces the Flow's thank-you).
   */
  async bookFromFlow(input: {
    workspaceId: string
    flowId: string
    contact: WhatsAppContact
    conversationId: string
    answers: Record<string, unknown>
    now?: Date
  }): Promise<Result<{ handled: boolean; text?: string }>> {
    const settings = await WhatsAppSchedulingSettingsRepository.findByWorkspace(
      input.workspaceId,
    )
    if (!settings.ok) return settings
    if (
      !settings.value?.enabled ||
      settings.value.bookingFlowId !== input.flowId
    ) {
      return ok({ handled: false })
    }
    const now = input.now ?? new Date()
    const config = settings.value

    const services = await WhatsAppSchedServiceRepository.list(
      input.workspaceId,
    )
    if (!services.ok) return services
    const wanted = normalizeText(String(input.answers.servico ?? ''))
    const service = services.value.find(
      (s) =>
        s.active &&
        (s.id === input.answers.servico || normalizeText(s.name) === wanted),
    )
    const dateKey = parseFlowDate(input.answers.data)
    const period = normalizeText(String(input.answers.periodo ?? ''))
    if (!service || !dateKey) {
      return ok({
        handled: true,
        text: 'Não consegui identificar o serviço ou a data. Um atendente vai falar com você para combinar o horário.',
      })
    }

    const professionals =
      await WhatsAppSchedProfessionalRepository.listForService(
        input.workspaceId,
        service.id,
      )
    if (!professionals.ok) return professionals
    const { today, last } = bookableRange(config, now)
    const free =
      dateKey >= today && dateKey <= last
        ? await availability({
            workspaceId: input.workspaceId,
            settings: config,
            service,
            professionals: professionals.value,
            dateKeys: [dateKey],
            now,
          })
        : ok([])
    if (!free.ok) return free

    const candidates = free.value
      .flatMap(({ professional, starts }) =>
        starts
          .filter((start) =>
            !period.startsWith('manha') && !period.startsWith('tarde')
              ? true
              : periodOf(start, config.timezone) ===
                (period.startsWith('manha') ? 'manha' : 'tarde'),
          )
          .map((start) => ({ professional, start })),
      )
      .sort((a, b) => a.start.getTime() - b.start.getTime())

    for (const candidate of candidates) {
      const booked = await book({
        workspaceId: input.workspaceId,
        settings: config,
        service,
        professional: candidate.professional,
        contact: input.contact,
        conversationId: input.conversationId,
        startsAt: candidate.start,
        source: 'FLOW',
        notify: false,
        now,
      })
      if (booked.ok) {
        return ok({
          handled: true,
          text: `Agendado! ${service.name} com ${candidate.professional.name}, ${formatAppointmentDate(candidate.start, config.timezone)}. Responda CONFIRMAR para garantir o horário ou CANCELAR se não puder ir.`,
        })
      }
      // Someone took it a moment ago: try the next one.
      if (booked.error.code !== 'WHATSAPP_SCHED_SLOT_TAKEN') return booked
    }
    return ok({
      handled: true,
      text: 'Não encontramos horário livre nesse dia e período. Um atendente vai falar com você para achar outra opção.',
    })
  },

  /**
   * Worker tick: confirmations that never went out and the reminders whose
   * time has come. A send that fails hands its right back, so the next tick
   * (a minute later) tries again until the appointment starts.
   */
  async tick(now: Date = new Date()): Promise<Result<SchedulingTickResult>> {
    const tally: SchedulingTickResult = {
      confirmations: 0,
      reminders: 0,
      failed: 0,
    }
    const horizon = new Date(now.getTime() + 8 * DAY_MS)
    const upcoming = await WhatsAppSchedAppointmentRepository.listUpcomingLive(
      now,
      horizon,
      TICK_BATCH,
    )
    if (!upcoming.ok) return upcoming

    const settingsCache = new Map<string, WhatsAppSchedulingSettings | null>()
    for (const appointment of upcoming.value) {
      let settings = settingsCache.get(appointment.workspaceId)
      if (settings === undefined) {
        const loaded =
          await WhatsAppSchedulingSettingsRepository.findByWorkspace(
            appointment.workspaceId,
          )
        settings = loaded.ok && loaded.value?.enabled ? loaded.value : null
        settingsCache.set(appointment.workspaceId, settings)
      }
      if (!settings?.connectionId) continue

      if (!appointment.confirmationSentAt && settings.confirmationTemplateId) {
        const sent = await sendConfirmation(appointment, settings)
        if (sent) tally.confirmations += 1
        else tally.failed += 1
        continue
      }

      const due = dueReminder({
        startsAt: appointment.startsAt,
        now,
        offsets: settings.reminderOffsets,
        sent: appointment.remindersSent,
      })
      if (!due || !settings.reminderTemplateId) continue
      const claimed = await WhatsAppSchedAppointmentRepository.claimReminder(
        appointment.id,
        due.send,
        due.markSent,
      )
      if (!claimed.ok || !claimed.value) continue
      const sent = await sendAutomationTemplate({
        workspaceId: appointment.workspaceId,
        connectionId: settings.connectionId,
        templateId: settings.reminderTemplateId,
        waId: appointment.contact.waId,
        contactName: appointment.contact.name,
        variables: messageVariables(appointment, settings),
        ignoreOptOut: true,
      })
      if (sent.ok && sent.value.kind === 'sent') {
        tally.reminders += 1
      } else {
        tally.failed += 1
        await WhatsAppSchedAppointmentRepository.releaseReminder(
          appointment.id,
          due.markSent,
        )
        logger.warn('whatsapp.scheduling.reminder_failed', {
          workspaceId: appointment.workspaceId,
          appointmentId: appointment.id,
          reason: sent.ok ? sent.value.kind : sent.error.code,
        })
      }
    }
    return ok(tally)
  },
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase()
}

/** `YYYY-MM-DD` from a Flow date answer (ISO text or epoch milliseconds). */
export function parseFlowDate(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value).trim()
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(text)
  if (iso) return iso[1]
  if (/^\d{10,13}$/.test(text)) {
    return new Date(Number(text.length === 10 ? `${text}000` : text))
      .toISOString()
      .slice(0, 10)
  }
  return null
}
