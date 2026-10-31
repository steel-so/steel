import type {
  Prisma,
  WhatsAppContact,
  WhatsAppSchedAppointment,
  WhatsAppSchedAppointmentStatus,
  WhatsAppSchedProfessional,
  WhatsAppSchedService,
  WhatsAppSchedulingSettings,
} from '@prisma/client'
import { whatsappSchedSlotTaken } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

const MINUTE_MS = 60_000

/** Statuses that hold the professional's time. */
export const LIVE_APPOINTMENT_STATUSES: WhatsAppSchedAppointmentStatus[] = [
  'PENDING',
  'CONFIRMED',
]

export type SchedProfessionalWithServices = WhatsAppSchedProfessional & {
  services: { serviceId: string }[]
}

export type SchedAppointmentFull = WhatsAppSchedAppointment & {
  service: WhatsAppSchedService
  professional: WhatsAppSchedProfessional
  contact: WhatsAppContact
}

const appointmentInclude = {
  service: true,
  professional: true,
  contact: true,
} as const

export const WhatsAppSchedulingSettingsRepository = {
  async findByWorkspace(
    workspaceId: string,
  ): Promise<Result<WhatsAppSchedulingSettings | null>> {
    try {
      return ok(
        await prisma.whatsAppSchedulingSettings.findUnique({
          where: { workspaceId },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find whatsapp scheduling settings', error))
    }
  },

  async upsert(
    workspaceId: string,
    data: Omit<
      Prisma.WhatsAppSchedulingSettingsUncheckedCreateInput,
      'workspaceId'
    >,
  ): Promise<Result<WhatsAppSchedulingSettings>> {
    try {
      return ok(
        await prisma.whatsAppSchedulingSettings.upsert({
          where: { workspaceId },
          create: { workspaceId, ...data },
          update: data,
        }),
      )
    } catch (error) {
      return err(
        dbError('Failed to upsert whatsapp scheduling settings', error),
      )
    }
  },
}

export const WhatsAppSchedServiceRepository = {
  async list(workspaceId: string): Promise<Result<WhatsAppSchedService[]>> {
    try {
      return ok(
        await prisma.whatsAppSchedService.findMany({
          where: { workspaceId },
          orderBy: [{ active: 'desc' }, { name: 'asc' }],
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list whatsapp sched services', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppSchedService | null>> {
    try {
      return ok(
        await prisma.whatsAppSchedService.findFirst({
          where: { id, workspaceId },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find whatsapp sched service', error))
    }
  },

  async create(
    data: Prisma.WhatsAppSchedServiceUncheckedCreateInput,
  ): Promise<Result<WhatsAppSchedService>> {
    try {
      return ok(await prisma.whatsAppSchedService.create({ data }))
    } catch (error) {
      return err(dbError('Failed to create whatsapp sched service', error))
    }
  },

  async update(
    id: string,
    data: Prisma.WhatsAppSchedServiceUncheckedUpdateInput,
  ): Promise<Result<WhatsAppSchedService>> {
    try {
      return ok(
        await prisma.whatsAppSchedService.update({ where: { id }, data }),
      )
    } catch (error) {
      return err(dbError('Failed to update whatsapp sched service', error))
    }
  },

  async countAppointments(id: string): Promise<Result<number>> {
    try {
      return ok(
        await prisma.whatsAppSchedAppointment.count({
          where: { serviceId: id },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to count whatsapp sched appointments', error))
    }
  },

  async delete(id: string): Promise<Result<void>> {
    try {
      await prisma.whatsAppSchedService.delete({ where: { id } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete whatsapp sched service', error))
    }
  },
}

export const WhatsAppSchedProfessionalRepository = {
  async list(
    workspaceId: string,
  ): Promise<Result<SchedProfessionalWithServices[]>> {
    try {
      return ok(
        await prisma.whatsAppSchedProfessional.findMany({
          where: { workspaceId },
          orderBy: [{ active: 'desc' }, { name: 'asc' }],
          include: { services: { select: { serviceId: true } } },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list whatsapp sched professionals', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<SchedProfessionalWithServices | null>> {
    try {
      return ok(
        await prisma.whatsAppSchedProfessional.findFirst({
          where: { id, workspaceId },
          include: { services: { select: { serviceId: true } } },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find whatsapp sched professional', error))
    }
  },

  /** Active professionals that offer the service. */
  async listForService(
    workspaceId: string,
    serviceId: string,
  ): Promise<Result<SchedProfessionalWithServices[]>> {
    try {
      return ok(
        await prisma.whatsAppSchedProfessional.findMany({
          where: {
            workspaceId,
            active: true,
            services: { some: { serviceId } },
          },
          orderBy: { name: 'asc' },
          include: { services: { select: { serviceId: true } } },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list whatsapp sched professionals', error))
    }
  },

  async create(
    data: Omit<
      Prisma.WhatsAppSchedProfessionalUncheckedCreateInput,
      'services'
    >,
    serviceIds: string[],
  ): Promise<Result<SchedProfessionalWithServices>> {
    try {
      return ok(
        await prisma.whatsAppSchedProfessional.create({
          data: {
            ...data,
            services: {
              create: serviceIds.map((serviceId) => ({ serviceId })),
            },
          },
          include: { services: { select: { serviceId: true } } },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to create whatsapp sched professional', error))
    }
  },

  async update(
    id: string,
    data: Prisma.WhatsAppSchedProfessionalUncheckedUpdateInput,
    serviceIds?: string[],
  ): Promise<Result<SchedProfessionalWithServices>> {
    try {
      return ok(
        await prisma.$transaction(async (tx) => {
          if (serviceIds) {
            await tx.whatsAppSchedProfessionalService.deleteMany({
              where: { professionalId: id },
            })
            await tx.whatsAppSchedProfessionalService.createMany({
              data: serviceIds.map((serviceId) => ({
                professionalId: id,
                serviceId,
              })),
            })
          }
          return tx.whatsAppSchedProfessional.update({
            where: { id },
            data,
            include: { services: { select: { serviceId: true } } },
          })
        }),
      )
    } catch (error) {
      return err(dbError('Failed to update whatsapp sched professional', error))
    }
  },

  async countAppointments(id: string): Promise<Result<number>> {
    try {
      return ok(
        await prisma.whatsAppSchedAppointment.count({
          where: { professionalId: id },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to count whatsapp sched appointments', error))
    }
  },

  async delete(id: string): Promise<Result<void>> {
    try {
      await prisma.whatsAppSchedProfessional.delete({ where: { id } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete whatsapp sched professional', error))
    }
  },
}

export interface CreateAppointmentInput {
  workspaceId: string
  serviceId: string
  professionalId: string
  contactId: string
  conversationId?: string | null
  startsAt: Date
  endsAt: Date
  bufferMinutes: number
  source: 'AGENT' | 'FLOW' | 'CONTACT'
  notes?: string | null
  createdById?: string | null
}

export const WhatsAppSchedAppointmentRepository = {
  /**
   * Books the slot if the professional is free for it. The overlap check and
   * the insert share a serializable transaction and the partial unique index
   * on `(professional_id, starts_at)` catches the exact-start race, so two
   * concurrent requests cannot both win.
   */
  async createIfFree(
    input: CreateAppointmentInput,
  ): Promise<Result<SchedAppointmentFull>> {
    try {
      const { bufferMinutes, ...data } = input
      const blockedUntil = new Date(
        input.endsAt.getTime() + bufferMinutes * MINUTE_MS,
      )
      const created = await prisma.$transaction(
        async (tx) => {
          const candidates = await tx.whatsAppSchedAppointment.findMany({
            where: {
              professionalId: input.professionalId,
              status: { in: LIVE_APPOINTMENT_STATUSES },
              startsAt: { lt: blockedUntil },
              endsAt: {
                gt: new Date(input.startsAt.getTime() - 24 * 60 * MINUTE_MS),
              },
            },
            include: { service: { select: { bufferMinutes: true } } },
          })
          // A neighbour's own buffer must not reach our start.
          const reaches = (row: (typeof candidates)[number]) =>
            row.endsAt.getTime() + row.service.bufferMinutes * MINUTE_MS >
            input.startsAt.getTime()
          if (candidates.some(reaches)) return null
          return tx.whatsAppSchedAppointment.create({
            data,
            include: appointmentInclude,
          })
        },
        { isolationLevel: 'Serializable' },
      )
      return created ? ok(created) : err(whatsappSchedSlotTaken())
    } catch (error) {
      const code = (error as { code?: string }).code
      // P2002 = the unique start index, P2034 = serialization failure.
      if (code === 'P2002' || code === 'P2034') {
        return err(whatsappSchedSlotTaken())
      }
      return err(dbError('Failed to create whatsapp sched appointment', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<SchedAppointmentFull | null>> {
    try {
      return ok(
        await prisma.whatsAppSchedAppointment.findFirst({
          where: { id, workspaceId },
          include: appointmentInclude,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find whatsapp sched appointment', error))
    }
  },

  async list(
    workspaceId: string,
    filter: {
      from: Date
      to: Date
      professionalId?: string
      status?: WhatsAppSchedAppointmentStatus
    },
  ): Promise<Result<SchedAppointmentFull[]>> {
    try {
      return ok(
        await prisma.whatsAppSchedAppointment.findMany({
          where: {
            workspaceId,
            startsAt: { gte: filter.from, lt: filter.to },
            ...(filter.professionalId
              ? { professionalId: filter.professionalId }
              : {}),
            ...(filter.status ? { status: filter.status } : {}),
          },
          orderBy: { startsAt: 'asc' },
          take: 500,
          include: appointmentInclude,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list whatsapp sched appointments', error))
    }
  },

  /** Live appointments (with their buffer) of the professionals in a range. */
  async listBusy(
    professionalIds: string[],
    from: Date,
    to: Date,
  ): Promise<
    Result<
      {
        professionalId: string
        startsAt: Date
        endsAt: Date
        service: { bufferMinutes: number }
      }[]
    >
  > {
    try {
      return ok(
        await prisma.whatsAppSchedAppointment.findMany({
          where: {
            professionalId: { in: professionalIds },
            status: { in: LIVE_APPOINTMENT_STATUSES },
            startsAt: { lt: to },
            endsAt: { gt: from },
          },
          select: {
            professionalId: true,
            startsAt: true,
            endsAt: true,
            service: { select: { bufferMinutes: true } },
          },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list whatsapp sched busy ranges', error))
    }
  },

  async update(
    id: string,
    data: Prisma.WhatsAppSchedAppointmentUncheckedUpdateInput,
  ): Promise<Result<SchedAppointmentFull>> {
    try {
      return ok(
        await prisma.whatsAppSchedAppointment.update({
          where: { id },
          data,
          include: appointmentInclude,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to update whatsapp sched appointment', error))
    }
  },

  /** The contact's next live appointment that already got a message. */
  async findNextNotified(
    workspaceId: string,
    contactId: string,
    now: Date,
  ): Promise<Result<SchedAppointmentFull | null>> {
    try {
      return ok(
        await prisma.whatsAppSchedAppointment.findFirst({
          where: {
            workspaceId,
            contactId,
            status: { in: LIVE_APPOINTMENT_STATUSES },
            startsAt: { gt: now },
            OR: [
              { confirmationSentAt: { not: null } },
              { NOT: { remindersSent: { isEmpty: true } } },
            ],
          },
          orderBy: { startsAt: 'asc' },
          include: appointmentInclude,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find whatsapp sched appointment', error))
    }
  },

  /** Live appointments starting before `until` whose messages may be due. */
  async listUpcomingLive(
    now: Date,
    until: Date,
    take: number,
  ): Promise<Result<SchedAppointmentFull[]>> {
    try {
      return ok(
        await prisma.whatsAppSchedAppointment.findMany({
          where: {
            status: { in: LIVE_APPOINTMENT_STATUSES },
            startsAt: { gt: now, lte: until },
          },
          orderBy: { startsAt: 'asc' },
          take,
          include: appointmentInclude,
        }),
      )
    } catch (error) {
      return err(
        dbError('Failed to list upcoming whatsapp appointments', error),
      )
    }
  },

  /**
   * Marks reminder offsets as sent. `false` when another tick already took
   * the `send` offset, so only one worker sends each reminder.
   */
  async claimReminder(
    id: string,
    send: number,
    markSent: number[],
  ): Promise<Result<boolean>> {
    try {
      const result = await prisma.whatsAppSchedAppointment.updateMany({
        where: { id, NOT: { remindersSent: { has: send } } },
        data: { remindersSent: { push: markSent } },
      })
      return ok(result.count === 1)
    } catch (error) {
      return err(
        dbError('Failed to claim whatsapp appointment reminder', error),
      )
    }
  },

  /** Gives the offsets back when the send failed, so a later tick retries. */
  async releaseReminder(id: string, offsets: number[]): Promise<Result<void>> {
    try {
      const row = await prisma.whatsAppSchedAppointment.findUnique({
        where: { id },
        select: { remindersSent: true },
      })
      if (!row) return ok(undefined)
      await prisma.whatsAppSchedAppointment.update({
        where: { id },
        data: {
          remindersSent: row.remindersSent.filter((o) => !offsets.includes(o)),
        },
      })
      return ok(undefined)
    } catch (error) {
      return err(
        dbError('Failed to release whatsapp appointment reminder', error),
      )
    }
  },

  /** Hands the confirmation back after a failed send. */
  async releaseConfirmation(id: string): Promise<Result<void>> {
    try {
      await prisma.whatsAppSchedAppointment.update({
        where: { id },
        data: { confirmationSentAt: null },
      })
      return ok(undefined)
    } catch (error) {
      return err(
        dbError('Failed to release whatsapp appointment confirmation', error),
      )
    }
  },

  /** Takes the right to send the first confirmation (once). */
  async claimConfirmation(id: string, at: Date): Promise<Result<boolean>> {
    try {
      const result = await prisma.whatsAppSchedAppointment.updateMany({
        where: { id, confirmationSentAt: null },
        data: { confirmationSentAt: at },
      })
      return ok(result.count === 1)
    } catch (error) {
      return err(
        dbError('Failed to claim whatsapp appointment confirmation', error),
      )
    }
  },
}
