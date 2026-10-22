import type { Prisma, WhatsAppPhoneCall } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import type { PhoneCallWithNames } from '@/src/mappers/whatsapp-phone-call.mapper'
import { dbError } from './db-error'

/** Names the timeline card shows next to the call. */
const WITH_NAMES = {
  user: { select: { name: true } },
  conversation: { select: { contact: { select: { name: true } } } },
} as const

/** Where a timeline lists its calls from (one record at a time). */
export type PhoneCallSource =
  | { conversationId: string }
  | { sdTicketId: string }
  | { crmPersonId: string }
  | { crmOpportunityId: string }

/** Calls a timeline lists at most (newest first). */
export const PHONE_CALL_LIST_LIMIT = 50

export const WhatsAppPhoneCallRepository = {
  async create(
    data: Prisma.WhatsAppPhoneCallUncheckedCreateInput,
  ): Promise<Result<WhatsAppPhoneCall>> {
    try {
      return ok(await prisma.whatsAppPhoneCall.create({ data }))
    } catch (error) {
      return err(dbError('Failed to create whatsapp phone call', error))
    }
  },

  async update(
    id: string,
    data: Prisma.WhatsAppPhoneCallUncheckedUpdateInput,
  ): Promise<Result<WhatsAppPhoneCall>> {
    try {
      return ok(await prisma.whatsAppPhoneCall.update({ where: { id }, data }))
    } catch (error) {
      return err(dbError('Failed to update whatsapp phone call', error))
    }
  },

  async findByCallbackTokenHash(
    callbackTokenHash: string,
  ): Promise<Result<WhatsAppPhoneCall | null>> {
    try {
      return ok(
        await prisma.whatsAppPhoneCall.findUnique({
          where: { callbackTokenHash },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find whatsapp phone call', error))
    }
  },

  async findByPabxUniqueId(
    workspaceId: string,
    pabxUniqueId: string,
  ): Promise<Result<WhatsAppPhoneCall | null>> {
    try {
      return ok(
        await prisma.whatsAppPhoneCall.findUnique({
          where: { workspaceId_pabxUniqueId: { workspaceId, pabxUniqueId } },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find whatsapp phone call', error))
    }
  },

  /** Calls of an extension still running since `since` (newest first). */
  async listLiveByExtension(
    workspaceId: string,
    extension: string,
    since: Date,
  ): Promise<Result<WhatsAppPhoneCall[]>> {
    try {
      return ok(
        await prisma.whatsAppPhoneCall.findMany({
          where: {
            workspaceId,
            extension,
            createdAt: { gte: since },
            status: { in: ['QUEUED', 'DIALING', 'IN_PROGRESS'] },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list live whatsapp phone calls', error))
    }
  },

  async findLatestByConversation(
    conversationId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppPhoneCall | null>> {
    try {
      return ok(
        await prisma.whatsAppPhoneCall.findFirst({
          // The header banner follows the PABX leg; browser phone calls
          // live in the dock.
          where: { conversationId, workspaceId, source: 'CLICK_TO_CALL' },
          orderBy: { createdAt: 'desc' },
        }),
      )
    } catch (error) {
      return err(
        dbError('Failed to find the latest whatsapp phone call', error),
      )
    }
  },
  async findById(id: string): Promise<Result<WhatsAppPhoneCall | null>> {
    try {
      return ok(await prisma.whatsAppPhoneCall.findUnique({ where: { id } }))
    } catch (error) {
      return err(dbError('Failed to find whatsapp phone call', error))
    }
  },

  async findWithNames(
    id: string,
    workspaceId: string,
  ): Promise<Result<PhoneCallWithNames | null>> {
    try {
      return ok(
        await prisma.whatsAppPhoneCall.findFirst({
          where: { id, workspaceId },
          include: WITH_NAMES,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find whatsapp phone call', error))
    }
  },

  /** Calls of one record, newest first (the timelines). */
  async listBySource(
    workspaceId: string,
    source: PhoneCallSource,
    limit = PHONE_CALL_LIST_LIMIT,
  ): Promise<Result<PhoneCallWithNames[]>> {
    try {
      return ok(
        await prisma.whatsAppPhoneCall.findMany({
          where: { workspaceId, ...source },
          include: WITH_NAMES,
          orderBy: { createdAt: 'desc' },
          take: limit,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list whatsapp phone calls', error))
    }
  },

  /** Recordings past their retention date (the retention job). */
  async listExpiredRecordings(
    now: Date,
    limit: number,
  ): Promise<
    Result<{ id: string; workspaceId: string; recordingKey: string | null }[]>
  > {
    try {
      return ok(
        await prisma.whatsAppPhoneCall.findMany({
          where: {
            recordingKey: { not: null },
            recordingExpiresAt: { lte: now },
          },
          select: { id: true, workspaceId: true, recordingKey: true },
          orderBy: { recordingExpiresAt: 'asc' },
          take: limit,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list expired call recordings', error))
    }
  },

  /** Which of these object keys still belong to a call (orphan sweep). */
  async findExistingRecordingKeys(
    keys: string[],
  ): Promise<Result<Set<string>>> {
    if (keys.length === 0) return ok(new Set())
    try {
      const rows = await prisma.whatsAppPhoneCall.findMany({
        where: { recordingKey: { in: keys } },
        select: { recordingKey: true },
      })
      return ok(
        new Set(
          rows
            .map((row) => row.recordingKey)
            .filter((key): key is string => Boolean(key)),
        ),
      )
    } catch (error) {
      return err(dbError('Failed to read call recording keys', error))
    }
  },

  /** Drops the audio fields after the object was deleted. */
  async clearRecording(id: string): Promise<Result<WhatsAppPhoneCall>> {
    try {
      return ok(
        await prisma.whatsAppPhoneCall.update({
          where: { id },
          data: {
            recordingKey: null,
            recordingMimeType: null,
            recordingSizeBytes: null,
            recordingExpiresAt: null,
          },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to clear call recording', error))
    }
  },
}
