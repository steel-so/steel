import type {
  Prisma,
  WhatsAppBroadcastList,
  WhatsAppBroadcastRecipient,
  WhatsAppBroadcastRecipientStatus,
  WhatsAppBroadcastStatus,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

const listInclude = {
  recipients: { select: { status: true } },
} satisfies Prisma.WhatsAppBroadcastListInclude

export type WhatsAppBroadcastListWithCounts =
  Prisma.WhatsAppBroadcastListGetPayload<{ include: typeof listInclude }>

const detailInclude = {
  recipients: { include: { contact: true } },
} satisfies Prisma.WhatsAppBroadcastListInclude

export type WhatsAppBroadcastListWithRecipients =
  Prisma.WhatsAppBroadcastListGetPayload<{ include: typeof detailInclude }>

export const WhatsAppBroadcastRepository = {
  async listByWorkspace(
    workspaceId: string,
  ): Promise<Result<WhatsAppBroadcastListWithCounts[]>> {
    try {
      const lists = await prisma.whatsAppBroadcastList.findMany({
        where: { workspaceId },
        include: listInclude,
        orderBy: { createdAt: 'desc' },
      })
      return ok(lists)
    } catch (error) {
      return err(dbError('Failed to list whatsapp broadcasts', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppBroadcastListWithRecipients | null>> {
    try {
      const list = await prisma.whatsAppBroadcastList.findFirst({
        where: { id, workspaceId },
        include: detailInclude,
      })
      return ok(list)
    } catch (error) {
      return err(dbError('Failed to find whatsapp broadcast', error))
    }
  },

  async findByIdRaw(id: string): Promise<Result<WhatsAppBroadcastList | null>> {
    try {
      const list = await prisma.whatsAppBroadcastList.findUnique({
        where: { id },
      })
      return ok(list)
    } catch (error) {
      return err(dbError('Failed to find whatsapp broadcast', error))
    }
  },

  async create(
    data: Prisma.WhatsAppBroadcastListUncheckedCreateInput,
    contactIds: string[],
  ): Promise<Result<WhatsAppBroadcastListWithRecipients>> {
    try {
      const list = await prisma.whatsAppBroadcastList.create({
        data: {
          ...data,
          recipients: {
            create: contactIds.map((contactId) => ({ contactId })),
          },
        },
        include: detailInclude,
      })
      return ok(list)
    } catch (error) {
      return err(dbError('Failed to create whatsapp broadcast', error))
    }
  },

  async createScheduled(
    data: Prisma.WhatsAppBroadcastListUncheckedCreateInput,
    recipients: {
      contactId: string
      variableValues: Prisma.InputJsonValue
      scheduledAt: Date
      appointmentAt: Date
    }[],
  ): Promise<Result<WhatsAppBroadcastListWithRecipients>> {
    try {
      const list = await prisma.whatsAppBroadcastList.create({
        data: {
          ...data,
          status: 'QUEUED',
          recipients: { create: recipients },
        },
        include: detailInclude,
      })
      return ok(list)
    } catch (error) {
      return err(
        dbError('Failed to create scheduled whatsapp broadcast', error),
      )
    }
  },

  async listDueScheduledRecipients(now: Date): Promise<
    Result<
      (WhatsAppBroadcastRecipient & {
        contact: {
          waId: string
          broadcastOptedOutAt: Date | null
          hasWhatsapp: boolean | null
        }
        broadcastList: WhatsAppBroadcastList
      })[]
    >
  > {
    try {
      const recipients = await prisma.whatsAppBroadcastRecipient.findMany({
        where: {
          status: 'PENDING',
          scheduledAt: { lte: now },
          broadcastList: { status: 'QUEUED' },
        },
        include: { contact: true, broadcastList: true },
      })
      return ok(recipients)
    } catch (error) {
      return err(
        dbError('Failed to list due scheduled broadcast recipients', error),
      )
    }
  },

  async updateStatus(
    id: string,
    status: WhatsAppBroadcastStatus,
  ): Promise<Result<void>> {
    try {
      await prisma.whatsAppBroadcastList.update({
        where: { id },
        data: { status },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to update whatsapp broadcast status', error))
    }
  },

  async listRecipients(
    broadcastListId: string,
  ): Promise<Result<WhatsAppBroadcastRecipient[]>> {
    try {
      const recipients = await prisma.whatsAppBroadcastRecipient.findMany({
        where: { broadcastListId },
        include: { contact: true },
      })
      return ok(recipients)
    } catch (error) {
      return err(dbError('Failed to list broadcast recipients', error))
    }
  },

  async findRecipientById(id: string): Promise<
    Result<
      | (WhatsAppBroadcastRecipient & {
          contact: {
            id: string
            name: string | null
            waId: string
            broadcastOptedOutAt: Date | null
            hasWhatsapp: boolean | null
          }
          broadcastList: WhatsAppBroadcastList
        })
      | null
    >
  > {
    try {
      const recipient = await prisma.whatsAppBroadcastRecipient.findUnique({
        where: { id },
        include: { contact: true, broadcastList: true },
      })
      return ok(recipient)
    } catch (error) {
      return err(dbError('Failed to find broadcast recipient', error))
    }
  },

  /** Recipients sent through the Marketing Messages Lite API and the span of
   * their send times (Z11). */
  async marketingLiteSummary(
    broadcastListId: string,
  ): Promise<Result<{ count: number; first: Date | null; last: Date | null }>> {
    try {
      const aggregate = await prisma.whatsAppBroadcastRecipient.aggregate({
        where: { broadcastListId, viaMarketingLite: true, status: 'SENT' },
        _count: { _all: true },
        _min: { sentAt: true },
        _max: { sentAt: true },
      })
      return ok({
        count: aggregate._count._all,
        first: aggregate._min.sentAt,
        last: aggregate._max.sentAt,
      })
    } catch (error) {
      return err(dbError('Failed to summarize marketing lite sends', error))
    }
  },

  async updateRecipientStatus(
    id: string,
    data: {
      status: WhatsAppBroadcastRecipientStatus
      providerMessageId?: string
      errorMessage?: string
      sentAt?: Date
      viaMarketingLite?: boolean
    },
  ): Promise<Result<void>> {
    try {
      await prisma.whatsAppBroadcastRecipient.update({ where: { id }, data })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to update broadcast recipient', error))
    }
  },

  /** Marca destinatários como SKIPPED (contato descadastrado antes do
   * disparo) — só os ainda PENDING. */
  async markRecipientsSkipped(ids: string[]): Promise<Result<number>> {
    if (ids.length === 0) return ok(0)
    try {
      const result = await prisma.whatsAppBroadcastRecipient.updateMany({
        where: { id: { in: ids }, status: 'PENDING' },
        data: {
          status: 'SKIPPED',
          errorMessage: 'Contato descadastrado (opt-out LGPD)',
        },
      })
      return ok(result.count)
    } catch (error) {
      return err(dbError('Failed to skip broadcast recipients', error))
    }
  },

  /** Marks one PENDING recipient as skipped for having no WhatsApp. */
  async markRecipientNoWhatsapp(id: string): Promise<Result<number>> {
    try {
      const result = await prisma.whatsAppBroadcastRecipient.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: 'SKIPPED_NO_WHATSAPP',
          errorMessage: 'Número sem WhatsApp',
        },
      })
      return ok(result.count)
    } catch (error) {
      return err(dbError('Failed to skip recipient without whatsapp', error))
    }
  },

  /** PENDING recipients of the list whose contact was checked and has no
   * WhatsApp become SKIPPED_NO_WHATSAPP. */
  async skipPendingWithoutWhatsapp(
    broadcastListId: string,
  ): Promise<Result<number>> {
    try {
      const result = await prisma.whatsAppBroadcastRecipient.updateMany({
        where: {
          broadcastListId,
          status: 'PENDING',
          contact: { hasWhatsapp: false },
        },
        data: {
          status: 'SKIPPED_NO_WHATSAPP',
          errorMessage: 'Número sem WhatsApp',
        },
      })
      return ok(result.count)
    } catch (error) {
      return err(dbError('Failed to skip recipients without whatsapp', error))
    }
  },

  async listRecipientContactIds(
    broadcastListId: string,
  ): Promise<Result<string[]>> {
    try {
      const rows = await prisma.whatsAppBroadcastRecipient.findMany({
        where: { broadcastListId },
        select: { contactId: true },
      })
      return ok(rows.map((row) => row.contactId))
    } catch (error) {
      return err(dbError('Failed to list broadcast recipient contacts', error))
    }
  },

  async setSkipNoWhatsapp(
    id: string,
    skipNoWhatsapp: boolean,
  ): Promise<Result<void>> {
    try {
      await prisma.whatsAppBroadcastList.update({
        where: { id },
        data: { skipNoWhatsapp },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to update broadcast skip setting', error))
    }
  },

  /** Recipients of the list per status (every status present, 0 default). */
  async countRecipientsByStatus(
    broadcastListId: string,
  ): Promise<Result<Record<WhatsAppBroadcastRecipientStatus, number>>> {
    try {
      const rows = await prisma.whatsAppBroadcastRecipient.groupBy({
        by: ['status'],
        where: { broadcastListId },
        _count: { _all: true },
      })
      const counts: Record<WhatsAppBroadcastRecipientStatus, number> = {
        PENDING: 0,
        SENT: 0,
        FAILED: 0,
        SKIPPED: 0,
        SKIPPED_NO_WHATSAPP: 0,
      }
      for (const row of rows) counts[row.status] = row._count._all
      return ok(counts)
    } catch (error) {
      return err(dbError('Failed to count broadcast recipients', error))
    }
  },

  /**
   * Closes a list that is still sending (QUEUED/RUNNING). Returns the list
   * when **this** call closed it, `null` when another job already did — so
   * the completion is announced once.
   */
  async closeIfRunning(
    id: string,
    status: Extract<WhatsAppBroadcastStatus, 'DONE' | 'FAILED'>,
  ): Promise<Result<WhatsAppBroadcastList | null>> {
    try {
      const [list] = await prisma.whatsAppBroadcastList.updateManyAndReturn({
        where: { id, status: { in: ['QUEUED', 'RUNNING'] } },
        data: { status },
      })
      return ok(list ?? null)
    } catch (error) {
      return err(dbError('Failed to close whatsapp broadcast', error))
    }
  },

  async countPendingRecipients(
    broadcastListId: string,
  ): Promise<Result<number>> {
    try {
      const count = await prisma.whatsAppBroadcastRecipient.count({
        where: { broadcastListId, status: 'PENDING' },
      })
      return ok(count)
    } catch (error) {
      return err(dbError('Failed to count pending recipients', error))
    }
  },

  async countFailedRecipients(
    broadcastListId: string,
  ): Promise<Result<number>> {
    try {
      const count = await prisma.whatsAppBroadcastRecipient.count({
        where: { broadcastListId, status: 'FAILED' },
      })
      return ok(count)
    } catch (error) {
      return err(dbError('Failed to count failed recipients', error))
    }
  },

  /** Próximo compromisso (ex: exame) do contato — usado pela IA via tool calling. */
  async findUpcomingAppointmentByContact(
    contactId: string,
    now: Date = new Date(),
  ): Promise<
    Result<
      (WhatsAppBroadcastRecipient & { broadcastList: { name: string } }) | null
    >
  > {
    try {
      const recipient = await prisma.whatsAppBroadcastRecipient.findFirst({
        where: { contactId, appointmentAt: { gte: now } },
        orderBy: { appointmentAt: 'asc' },
        include: { broadcastList: { select: { name: true } } },
      })
      return ok(recipient)
    } catch (error) {
      return err(dbError('Failed to find upcoming appointment', error))
    }
  },
}
