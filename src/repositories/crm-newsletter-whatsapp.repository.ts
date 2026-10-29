import type {
  CrmNewsletterDeliveryStatus,
  CrmNewsletterIssueWhatsApp,
  CrmNewsletterWhatsAppRecipient,
  Prisma,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import type { CrmNewsletterWhatsAppStatsDTO } from '@/src/schemas/crm-newsletter-engage.schema'
import { dbError } from './db-error'

/**
 * WhatsApp version of newsletter issues (slice nl2-engage): the per-issue
 * configuration, the audience snapshot (one row per number) and the
 * worker's claim/outcome of each send.
 */

export type WhatsAppCandidate = {
  subscriberId: string
  personId: string
  name: string
  phones: string[]
}

export type WhatsAppRecipientInput = Pick<
  CrmNewsletterWhatsAppRecipient,
  'subscriberId' | 'personId' | 'name' | 'waId' | 'status' | 'skipReason'
>

const EMPTY_STATS: CrmNewsletterWhatsAppStatsDTO = {
  total: 0,
  pending: 0,
  sent: 0,
  failed: 0,
  skipped: 0,
  delivered: 0,
  read: 0,
}

/** Provider receipt of a sent message (nl3-whatsapp-receipts). */
export type WhatsAppReceipt = 'DELIVERED' | 'READ' | 'FAILED'

export type WhatsAppReceiptTarget = Pick<
  CrmNewsletterWhatsAppRecipient,
  'id' | 'issueId' | 'workspaceId' | 'subscriberId'
>

/** People (not deleted) of the workspace with their phones, by id. */
async function peopleById(workspaceId: string, personIds: string[]) {
  const people = await prisma.crmPerson.findMany({
    where: { workspaceId, id: { in: personIds }, deletedAt: null },
    select: { id: true, name: true, phones: true },
  })
  return new Map(people.map((person) => [person.id, person]))
}

function toCandidates(
  rows: { subscriberId: string; personId: string | null }[],
  people: Map<string, { name: string; phones: string[] }>,
): WhatsAppCandidate[] {
  const candidates: WhatsAppCandidate[] = []
  // Callers only pass rows with a person; a deleted person drops out.
  for (const row of rows) {
    const person = people.get(row.personId as string)
    if (!person) continue
    candidates.push({
      subscriberId: row.subscriberId,
      personId: row.personId as string,
      name: person.name,
      phones: person.phones,
    })
  }
  return candidates
}

export const CrmNewsletterWhatsAppRepository = {
  async findConfig(
    issueId: string,
  ): Promise<Result<CrmNewsletterIssueWhatsApp | null>> {
    try {
      return ok(
        await prisma.crmNewsletterIssueWhatsApp.findUnique({
          where: { issueId },
        }),
      )
    } catch (error) {
      return err(
        dbError('Failed to find CRM newsletter WhatsApp config', error),
      )
    }
  },

  async upsertConfig(
    issueId: string,
    workspaceId: string,
    data: Omit<
      Prisma.CrmNewsletterIssueWhatsAppUncheckedCreateInput,
      'issueId' | 'workspaceId'
    >,
  ): Promise<Result<CrmNewsletterIssueWhatsApp>> {
    try {
      return ok(
        await prisma.crmNewsletterIssueWhatsApp.upsert({
          where: { issueId },
          create: { issueId, workspaceId, ...data },
          update: data,
        }),
      )
    } catch (error) {
      return err(
        dbError('Failed to save CRM newsletter WhatsApp config', error),
      )
    }
  },

  /**
   * Marks the snapshot as taken; only the first caller wins (`true`), so a
   * retried start never snapshots twice.
   */
  async markStarted(issueId: string, now: Date): Promise<Result<boolean>> {
    try {
      const updated = await prisma.crmNewsletterIssueWhatsApp.updateMany({
        where: { issueId, enabled: true, startedAt: null },
        data: { startedAt: now },
      })
      return ok(updated.count === 1)
    } catch (error) {
      return err(dbError('Failed to start CRM newsletter WhatsApp', error))
    }
  },

  /** Active subscribers linked to a CRM person (reach preview). */
  async subscriberCandidates(
    workspaceId: string,
    newsletterId: string,
  ): Promise<Result<{ candidates: WhatsAppCandidate[]; linked: number }>> {
    try {
      const subscribers = await prisma.crmNewsletterSubscriber.findMany({
        where: { newsletterId, status: 'ACTIVE', personId: { not: null } },
        select: { id: true, personId: true },
      })
      const people = await peopleById(
        workspaceId,
        subscribers.map((row) => row.personId as string),
      )
      const candidates = toCandidates(
        subscribers.map((row) => ({ ...row, subscriberId: row.id })),
        people,
      )
      return ok({ candidates, linked: candidates.length })
    } catch (error) {
      return err(dbError('Failed to read CRM newsletter WhatsApp reach', error))
    }
  },

  /** E-mail snapshot of a started issue, restricted to linked people. */
  async issueCandidates(
    workspaceId: string,
    issueId: string,
  ): Promise<Result<WhatsAppCandidate[]>> {
    try {
      const recipients = await prisma.crmNewsletterIssueRecipient.findMany({
        where: { issueId, subscriber: { personId: { not: null } } },
        select: {
          subscriberId: true,
          subscriber: { select: { personId: true } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
      const people = await peopleById(
        workspaceId,
        recipients.map((row) => row.subscriber.personId as string),
      )
      return ok(
        toCandidates(
          recipients.map((row) => ({
            subscriberId: row.subscriberId,
            personId: row.subscriber.personId,
          })),
          people,
        ),
      )
    } catch (error) {
      return err(
        dbError('Failed to read CRM newsletter WhatsApp audience', error),
      )
    }
  },

  /** Numbers (waId) that opted out of broadcasts in the workspace. */
  async optedOut(
    workspaceId: string,
    waIds: string[],
  ): Promise<Result<Set<string>>> {
    if (waIds.length === 0) return ok(new Set())
    try {
      const contacts = await prisma.whatsAppContact.findMany({
        where: {
          workspaceId,
          waId: { in: waIds },
          broadcastOptedOutAt: { not: null },
        },
        select: { waId: true },
      })
      return ok(new Set(contacts.map((contact) => contact.waId)))
    } catch (error) {
      return err(dbError('Failed to read WhatsApp opt-outs', error))
    }
  },

  async createRecipients(
    issueId: string,
    workspaceId: string,
    rows: WhatsAppRecipientInput[],
  ): Promise<Result<number>> {
    if (rows.length === 0) return ok(0)
    try {
      const created = await prisma.crmNewsletterWhatsAppRecipient.createMany({
        data: rows.map((row) => ({ ...row, issueId, workspaceId })),
        skipDuplicates: true,
      })
      return ok(created.count)
    } catch (error) {
      return err(dbError('Failed to snapshot CRM newsletter WhatsApp', error))
    }
  },

  /** Claims up to `limit` PENDING rows (→ SENDING), skipping locked ones. */
  async claimBatch(
    issueId: string,
    limit: number,
  ): Promise<Result<CrmNewsletterWhatsAppRecipient[]>> {
    try {
      const claimed = await prisma.$queryRaw<{ id: string }[]>`
        UPDATE crm_newsletter_whatsapp_recipients
        SET status = 'SENDING'::"CrmNewsletterDeliveryStatus", updated_at = NOW()
        WHERE id IN (
          SELECT id FROM crm_newsletter_whatsapp_recipients
          WHERE issue_id = ${issueId} AND status = 'PENDING'::"CrmNewsletterDeliveryStatus"
          ORDER BY created_at, id
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id`
      if (claimed.length === 0) return ok([])
      return ok(
        await prisma.crmNewsletterWhatsAppRecipient.findMany({
          where: { id: { in: claimed.map((row) => row.id) } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        }),
      )
    } catch (error) {
      return err(dbError('Failed to claim CRM newsletter WhatsApp rows', error))
    }
  },

  /** SENDING rows left behind by a crashed job go back to PENDING. */
  async releaseStuck(issueId: string, before: Date): Promise<Result<number>> {
    try {
      const released = await prisma.crmNewsletterWhatsAppRecipient.updateMany({
        where: { issueId, status: 'SENDING', updatedAt: { lt: before } },
        data: { status: 'PENDING' },
      })
      return ok(released.count)
    } catch (error) {
      return err(
        dbError('Failed to release CRM newsletter WhatsApp rows', error),
      )
    }
  },

  async release(ids: string[]): Promise<Result<void>> {
    if (ids.length === 0) return ok(undefined)
    try {
      await prisma.crmNewsletterWhatsAppRecipient.updateMany({
        where: { id: { in: ids }, status: 'SENDING' },
        data: { status: 'PENDING' },
      })
      return ok(undefined)
    } catch (error) {
      return err(
        dbError('Failed to release CRM newsletter WhatsApp rows', error),
      )
    }
  },

  async markSent(
    id: string,
    providerMessageId: string,
    now: Date,
  ): Promise<Result<void>> {
    try {
      await prisma.crmNewsletterWhatsAppRecipient.updateMany({
        where: { id, status: 'SENDING' },
        data: { status: 'SENT', providerMessageId, sentAt: now, error: null },
      })
      return ok(undefined)
    } catch (error) {
      return err(
        dbError('Failed to record CRM newsletter WhatsApp send', error),
      )
    }
  },

  async markFailed(id: string, error: string): Promise<Result<void>> {
    try {
      await prisma.crmNewsletterWhatsAppRecipient.updateMany({
        where: { id, status: 'SENDING' },
        data: { status: 'FAILED', error: error.slice(0, 500) },
      })
      return ok(undefined)
    } catch (cause) {
      return err(
        dbError('Failed to record CRM newsletter WhatsApp failure', cause),
      )
    }
  },

  /** SENDING rows → SKIPPED with `reason`. */
  async markSkipped(ids: string[], reason: string): Promise<Result<void>> {
    if (ids.length === 0) return ok(undefined)
    try {
      await prisma.crmNewsletterWhatsAppRecipient.updateMany({
        where: { id: { in: ids }, status: 'SENDING' },
        data: { status: 'SKIPPED', skipReason: reason },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to skip CRM newsletter WhatsApp rows', error))
    }
  },

  /** Every PENDING row of the issue → SKIPPED with `reason`. */
  async skipPending(issueId: string, reason: string): Promise<Result<number>> {
    try {
      const skipped = await prisma.crmNewsletterWhatsAppRecipient.updateMany({
        where: { issueId, status: 'PENDING' },
        data: { status: 'SKIPPED', skipReason: reason },
      })
      return ok(skipped.count)
    } catch (error) {
      return err(dbError('Failed to skip CRM newsletter WhatsApp rows', error))
    }
  },

  /** Newsletter WhatsApp messages sent through a connection since `since`
   * (Meta tier: business-initiated conversations per 24 h). */
  async countSentSince(
    connectionId: string,
    since: Date,
  ): Promise<Result<number>> {
    try {
      return ok(
        await prisma.crmNewsletterWhatsAppRecipient.count({
          where: {
            status: 'SENT',
            sentAt: { gte: since },
            issue: { whatsapp: { connectionId } },
          },
        }),
      )
    } catch (error) {
      return err(
        dbError('Failed to count CRM newsletter WhatsApp sends', error),
      )
    }
  },

  /** Recipient row of a provider message id (nl3-whatsapp-receipts). */
  async findByProviderMessageId(
    providerMessageId: string,
  ): Promise<Result<WhatsAppReceiptTarget | null>> {
    try {
      return ok(
        await prisma.crmNewsletterWhatsAppRecipient.findFirst({
          where: { providerMessageId },
          select: {
            id: true,
            issueId: true,
            workspaceId: true,
            subscriberId: true,
          },
        }),
      )
    } catch (error) {
      return err(
        dbError('Failed to find CRM newsletter WhatsApp recipient', error),
      )
    }
  },

  /**
   * Applies a provider receipt to a SENT row, forward only and once:
   * DELIVERED stamps `deliveredAt`; READ stamps `readAt` (and `deliveredAt`
   * when the delivered webhook never came); FAILED moves a row not yet
   * delivered to FAILED with `failedAt` and the provider error. Returns
   * whether the receipt changed the row (`false` = repeated or late).
   */
  async applyReceipt(
    id: string,
    receipt: WhatsAppReceipt,
    at: Date,
    error?: string | null,
  ): Promise<Result<boolean>> {
    const model = prisma.crmNewsletterWhatsAppRecipient
    const sent = { id, status: 'SENT' as const }
    try {
      if (receipt === 'FAILED') {
        const failed = await model.updateMany({
          where: { ...sent, deliveredAt: null, readAt: null },
          data: {
            status: 'FAILED',
            failedAt: at,
            error: (error || 'Falha informada pelo WhatsApp').slice(0, 500),
          },
        })
        return ok(failed.count > 0)
      }
      const delivered = await model.updateMany({
        where: { ...sent, deliveredAt: null },
        data: { deliveredAt: at },
      })
      if (receipt === 'DELIVERED') return ok(delivered.count > 0)
      const read = await model.updateMany({
        where: { ...sent, readAt: null },
        data: { readAt: at },
      })
      return ok(read.count > 0)
    } catch (cause) {
      return err(
        dbError('Failed to record CRM newsletter WhatsApp receipt', cause),
      )
    }
  },

  async stats(issueId: string): Promise<Result<CrmNewsletterWhatsAppStatsDTO>> {
    try {
      const model = prisma.crmNewsletterWhatsAppRecipient
      const [rows, delivered, read] = await Promise.all([
        model.groupBy({
          by: ['status'],
          where: { issueId },
          _count: { _all: true },
        }),
        model.count({
          where: { issueId, status: 'SENT', deliveredAt: { not: null } },
        }),
        model.count({
          where: { issueId, status: 'SENT', readAt: { not: null } },
        }),
      ])
      const stats = { ...EMPTY_STATS, delivered, read }
      for (const row of rows) {
        const count = row._count._all
        stats.total += count
        if (row.status === 'SENT') stats.sent += count
        else if (row.status === 'FAILED') stats.failed += count
        else if (row.status === 'SKIPPED') stats.skipped += count
        else stats.pending += count
      }
      return ok(stats)
    } catch (error) {
      return err(dbError('Failed to read CRM newsletter WhatsApp stats', error))
    }
  },

  async listRecipients(
    issueId: string,
    query: {
      page: number
      pageSize: number
      status?: CrmNewsletterDeliveryStatus
    },
  ): Promise<
    Result<{ items: CrmNewsletterWhatsAppRecipient[]; total: number }>
  > {
    const where: Prisma.CrmNewsletterWhatsAppRecipientWhereInput = {
      issueId,
      ...(query.status ? { status: query.status } : {}),
    }
    try {
      const [items, total] = await Promise.all([
        prisma.crmNewsletterWhatsAppRecipient.findMany({
          where,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        prisma.crmNewsletterWhatsAppRecipient.count({ where }),
      ])
      return ok({ items, total })
    } catch (error) {
      return err(dbError('Failed to list CRM newsletter WhatsApp rows', error))
    }
  },
}
