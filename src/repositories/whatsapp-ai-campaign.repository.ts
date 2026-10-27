import type {
  Prisma,
  WhatsAppAiCampaign,
  WhatsAppAiCampaignActionRun,
  WhatsAppAiCampaignRecipient,
  WhatsAppAiCampaignRecipientStatus,
  WhatsAppContact,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import type { WhatsAppAiCampaignStatsDTO } from '@/types/whatsapp-ai-campaign'
import { dbError } from './db-error'

const campaignInclude = {
  connection: { select: { id: true, provider: true, module: true } },
  template: {
    select: {
      id: true,
      name: true,
      language: true,
      status: true,
      components: true,
      connectionId: true,
    },
  },
} satisfies Prisma.WhatsAppAiCampaignInclude

export type WhatsAppAiCampaignWithTemplate =
  Prisma.WhatsAppAiCampaignGetPayload<{
    include: typeof campaignInclude
  }>

export type WhatsAppAiCampaignRecipientWithContact =
  WhatsAppAiCampaignRecipient & { contact: WhatsAppContact }

export type WhatsAppAiCampaignRecipientRow = WhatsAppAiCampaignRecipient & {
  contact: Pick<WhatsAppContact, 'name' | 'waId' | 'createdAt'>
  conversation: {
    status: 'NEW' | 'IN_PROGRESS' | 'CLOSED'
    closeOutcome: 'SUCCESS' | 'FAILURE' | null
  } | null
}

export function emptyAiCampaignStats(): WhatsAppAiCampaignStatsDTO {
  return {
    total: 0,
    pending: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    replied: 0,
    success: 0,
    failure: 0,
    closedWithoutOutcome: 0,
    open: 0,
  }
}

const RECIPIENT_STATUS_KEY: Record<
  WhatsAppAiCampaignRecipientStatus,
  'pending' | 'sent' | 'failed' | 'skipped'
> = { PENDING: 'pending', SENT: 'sent', FAILED: 'failed', SKIPPED: 'skipped' }

export const WhatsAppAiCampaignRepository = {
  /** Campaigns of the workspace (archived ones left out), newest first. */
  async listByWorkspace(
    workspaceId: string,
  ): Promise<Result<WhatsAppAiCampaignWithTemplate[]>> {
    try {
      const campaigns = await prisma.whatsAppAiCampaign.findMany({
        where: { workspaceId, status: { not: 'ARCHIVED' } },
        orderBy: { createdAt: 'desc' },
        include: campaignInclude,
      })
      return ok(campaigns)
    } catch (error) {
      return err(dbError('Failed to list whatsapp ai campaigns', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppAiCampaignWithTemplate | null>> {
    try {
      const campaign = await prisma.whatsAppAiCampaign.findFirst({
        where: { id, workspaceId },
        include: campaignInclude,
      })
      return ok(campaign)
    } catch (error) {
      return err(dbError('Failed to find whatsapp ai campaign', error))
    }
  },

  /** System lookup (worker, AI reply) — no workspace scope. */
  async findByIdRaw(id: string): Promise<Result<WhatsAppAiCampaign | null>> {
    try {
      const campaign = await prisma.whatsAppAiCampaign.findUnique({
        where: { id },
      })
      return ok(campaign)
    } catch (error) {
      return err(dbError('Failed to find whatsapp ai campaign', error))
    }
  },

  async create(
    data: Prisma.WhatsAppAiCampaignUncheckedCreateInput,
  ): Promise<Result<WhatsAppAiCampaignWithTemplate>> {
    try {
      const campaign = await prisma.whatsAppAiCampaign.create({
        data,
        include: campaignInclude,
      })
      return ok(campaign)
    } catch (error) {
      return err(dbError('Failed to create whatsapp ai campaign', error))
    }
  },

  async update(
    id: string,
    data: Prisma.WhatsAppAiCampaignUncheckedUpdateInput,
  ): Promise<Result<WhatsAppAiCampaignWithTemplate>> {
    try {
      const campaign = await prisma.whatsAppAiCampaign.update({
        where: { id },
        data,
        include: campaignInclude,
      })
      return ok(campaign)
    } catch (error) {
      return err(dbError('Failed to update whatsapp ai campaign', error))
    }
  },

  /**
   * Stops the run only if it is still the one identified by `runToken` —
   * a play/pause in between wins over the worker's automatic stop.
   */
  async stopRun(
    id: string,
    runToken: string,
    data: Pick<
      Prisma.WhatsAppAiCampaignUncheckedUpdateInput,
      'status' | 'lastError' | 'finishedAt'
    >,
  ): Promise<Result<boolean>> {
    try {
      const updated = await prisma.whatsAppAiCampaign.updateMany({
        where: { id, runToken, status: 'RUNNING' },
        data: { ...data, runToken: null },
      })
      return ok(updated.count > 0)
    } catch (error) {
      return err(dbError('Failed to stop whatsapp ai campaign', error))
    }
  },

  /** Funnel of each campaign: queue, replies and how its conversations closed. */
  async statsFor(
    campaignIds: string[],
  ): Promise<Result<Map<string, WhatsAppAiCampaignStatsDTO>>> {
    const stats = new Map(
      campaignIds.map((id) => [id, emptyAiCampaignStats()] as const),
    )
    if (campaignIds.length === 0) return ok(stats)
    try {
      const [byStatus, replied, conversations] = await Promise.all([
        prisma.whatsAppAiCampaignRecipient.groupBy({
          by: ['campaignId', 'status'],
          where: { campaignId: { in: campaignIds } },
          _count: { _all: true },
        }),
        prisma.whatsAppAiCampaignRecipient.groupBy({
          by: ['campaignId'],
          where: { campaignId: { in: campaignIds }, repliedAt: { not: null } },
          _count: { _all: true },
        }),
        prisma.whatsAppConversation.groupBy({
          by: ['aiCampaignId', 'status', 'closeOutcome'],
          where: { aiCampaignId: { in: campaignIds }, deletedAt: null },
          _count: { _all: true },
        }),
      ])
      for (const row of byStatus) {
        const entry = stats.get(row.campaignId)
        if (!entry) continue
        entry[RECIPIENT_STATUS_KEY[row.status]] += row._count._all
        entry.total += row._count._all
      }
      for (const row of replied) {
        const entry = stats.get(row.campaignId)
        if (entry) entry.replied = row._count._all
      }
      for (const row of conversations) {
        const entry = row.aiCampaignId ? stats.get(row.aiCampaignId) : null
        if (!entry) continue
        if (row.status !== 'CLOSED') entry.open += row._count._all
        else if (row.closeOutcome === 'SUCCESS')
          entry.success += row._count._all
        else if (row.closeOutcome === 'FAILURE')
          entry.failure += row._count._all
        else entry.closedWithoutOutcome += row._count._all
      }
      return ok(stats)
    } catch (error) {
      return err(dbError('Failed to count whatsapp ai campaign stats', error))
    }
  },

  async countPending(campaignId: string): Promise<Result<number>> {
    try {
      const count = await prisma.whatsAppAiCampaignRecipient.count({
        where: { campaignId, status: 'PENDING' },
      })
      return ok(count)
    } catch (error) {
      return err(dbError('Failed to count whatsapp ai campaign queue', error))
    }
  },

  /** Contact ids queued in the campaign (any status). */
  async listRecipientContactIds(campaignId: string): Promise<Result<string[]>> {
    try {
      const rows = await prisma.whatsAppAiCampaignRecipient.findMany({
        where: { campaignId },
        select: { contactId: true },
      })
      return ok(rows.map((row) => row.contactId))
    } catch (error) {
      return err(
        dbError(
          'Failed to list whatsapp ai campaign recipient contacts',
          error,
        ),
      )
    }
  },

  /** Workspace contacts (not opted out) among `contactIds`, or all of them. */
  async listQueueableContactIds(
    workspaceId: string,
    contactIds: string[] | null,
    limit: number,
  ): Promise<Result<string[]>> {
    try {
      const contacts = await prisma.whatsAppContact.findMany({
        where: {
          workspaceId,
          broadcastOptedOutAt: null,
          ...(contactIds ? { id: { in: contactIds } } : {}),
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: limit,
      })
      return ok(contacts.map((contact) => contact.id))
    } catch (error) {
      return err(dbError('Failed to list whatsapp contacts to queue', error))
    }
  },

  /**
   * Creates the spreadsheet's new contacts (existing ones are kept as they
   * are) and returns the id of every phone.
   */
  async ensureContacts(
    workspaceId: string,
    rows: { waId: string; name?: string }[],
  ): Promise<Result<Map<string, { id: string; optedOut: boolean }>>> {
    try {
      await prisma.whatsAppContact.createMany({
        data: rows.map((row) => ({
          workspaceId,
          waId: row.waId,
          name: row.name || null,
        })),
        skipDuplicates: true,
      })
      const contacts = await prisma.whatsAppContact.findMany({
        where: { workspaceId, waId: { in: rows.map((row) => row.waId) } },
        select: { id: true, waId: true, broadcastOptedOutAt: true },
      })
      return ok(
        new Map(
          contacts.map((contact) => [
            contact.waId,
            { id: contact.id, optedOut: contact.broadcastOptedOutAt !== null },
          ]),
        ),
      )
    } catch (error) {
      return err(dbError('Failed to import whatsapp contacts', error))
    }
  },

  /** Queues the contacts; ones already in the campaign (any status) stay. */
  async addRecipients(
    campaignId: string,
    rows: { contactId: string; values?: Record<string, string> }[],
  ): Promise<Result<number>> {
    try {
      const created = await prisma.whatsAppAiCampaignRecipient.createMany({
        data: rows.map((row) => ({
          campaignId,
          contactId: row.contactId,
          ...(row.values && Object.keys(row.values).length > 0
            ? { values: row.values }
            : {}),
        })),
        skipDuplicates: true,
      })
      return ok(created.count)
    } catch (error) {
      return err(dbError('Failed to queue whatsapp ai campaign', error))
    }
  },

  /** Clears the pending queue, or every contact with `all`. */
  async clearRecipients(
    campaignId: string,
    all: boolean,
  ): Promise<Result<number>> {
    try {
      const deleted = await prisma.whatsAppAiCampaignRecipient.deleteMany({
        where: { campaignId, ...(all ? {} : { status: 'PENDING' }) },
      })
      return ok(deleted.count)
    } catch (error) {
      return err(dbError('Failed to clear whatsapp ai campaign queue', error))
    }
  },

  async findNextPending(
    campaignId: string,
  ): Promise<Result<WhatsAppAiCampaignRecipientWithContact | null>> {
    try {
      const recipient = await prisma.whatsAppAiCampaignRecipient.findFirst({
        where: { campaignId, status: 'PENDING' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: { contact: true },
      })
      return ok(recipient)
    } catch (error) {
      return err(
        dbError('Failed to find next whatsapp ai campaign recipient', error),
      )
    }
  },

  async updateRecipient(
    id: string,
    data: Prisma.WhatsAppAiCampaignRecipientUncheckedUpdateInput,
  ): Promise<Result<WhatsAppAiCampaignRecipient>> {
    try {
      const recipient = await prisma.whatsAppAiCampaignRecipient.update({
        where: { id },
        data,
      })
      return ok(recipient)
    } catch (error) {
      return err(
        dbError('Failed to update whatsapp ai campaign recipient', error),
      )
    }
  },

  /** A page of the campaign's contacts, with how their conversation is. */
  async listRecipients(
    campaignId: string,
    options: {
      status?: WhatsAppAiCampaignRecipientStatus
      search?: string
      cursor?: string
      limit: number
    },
  ): Promise<Result<WhatsAppAiCampaignRecipientRow[]>> {
    try {
      const rows = await prisma.whatsAppAiCampaignRecipient.findMany({
        where: {
          campaignId,
          ...(options.status ? { status: options.status } : {}),
          ...(options.search
            ? {
                contact: {
                  OR: [
                    { name: { contains: options.search, mode: 'insensitive' } },
                    { waId: { contains: options.search } },
                  ],
                },
              }
            : {}),
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: options.limit,
        ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
        include: {
          contact: { select: { name: true, waId: true, createdAt: true } },
        },
      })
      const conversationIds = rows
        .map((row) => row.conversationId)
        .filter((id): id is string => Boolean(id))
      const conversations = conversationIds.length
        ? await prisma.whatsAppConversation.findMany({
            where: { id: { in: conversationIds } },
            select: { id: true, status: true, closeOutcome: true },
          })
        : []
      const byId = new Map(conversations.map((c) => [c.id, c]))
      return ok(
        rows.map((row) => {
          const conversation = row.conversationId
            ? byId.get(row.conversationId)
            : undefined
          return {
            ...row,
            conversation: conversation
              ? {
                  status: conversation.status,
                  closeOutcome: conversation.closeOutcome,
                }
              : null,
          }
        }),
      )
    } catch (error) {
      return err(
        dbError('Failed to list whatsapp ai campaign recipients', error),
      )
    }
  },

  /** First reply of the contact after the send (funnel "responderam"). */
  async markReplied(conversationId: string, at: Date): Promise<Result<number>> {
    try {
      const updated = await prisma.whatsAppAiCampaignRecipient.updateMany({
        where: { conversationId, status: 'SENT', repliedAt: null },
        data: { repliedAt: at },
      })
      return ok(updated.count)
    } catch (error) {
      return err(dbError('Failed to mark whatsapp ai campaign reply', error))
    }
  },

  async createActionRun(
    data: Prisma.WhatsAppAiCampaignActionRunUncheckedCreateInput,
  ): Promise<Result<WhatsAppAiCampaignActionRun>> {
    try {
      const run = await prisma.whatsAppAiCampaignActionRun.create({ data })
      return ok(run)
    } catch (error) {
      return err(dbError('Failed to record whatsapp ai campaign action', error))
    }
  },

  async updateActionRun(
    id: string,
    data: Prisma.WhatsAppAiCampaignActionRunUncheckedUpdateInput,
  ): Promise<Result<WhatsAppAiCampaignActionRun>> {
    try {
      const run = await prisma.whatsAppAiCampaignActionRun.update({
        where: { id },
        data,
      })
      return ok(run)
    } catch (error) {
      return err(dbError('Failed to update whatsapp ai campaign action', error))
    }
  },

  async findActionRun(
    id: string,
  ): Promise<Result<WhatsAppAiCampaignActionRun | null>> {
    try {
      const run = await prisma.whatsAppAiCampaignActionRun.findUnique({
        where: { id },
      })
      return ok(run)
    } catch (error) {
      return err(dbError('Failed to find whatsapp ai campaign action', error))
    }
  },

  /** Latest actions the AI ran in the campaign, with the contact's name. */
  async listActionRuns(
    campaignId: string,
    limit: number,
  ): Promise<
    Result<(WhatsAppAiCampaignActionRun & { contactName: string | null })[]>
  > {
    try {
      const runs = await prisma.whatsAppAiCampaignActionRun.findMany({
        where: { campaignId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      })
      const contactIds = runs
        .map((run) => run.contactId)
        .filter((id): id is string => Boolean(id))
      const contacts = contactIds.length
        ? await prisma.whatsAppContact.findMany({
            where: { id: { in: contactIds } },
            select: { id: true, name: true, waId: true },
          })
        : []
      const byId = new Map(contacts.map((c) => [c.id, c.name ?? c.waId]))
      return ok(
        runs.map((run) => ({
          ...run,
          contactName: run.contactId ? (byId.get(run.contactId) ?? null) : null,
        })),
      )
    } catch (error) {
      return err(dbError('Failed to list whatsapp ai campaign actions', error))
    }
  },
}
