import type {
  Prisma,
  WorkspaceSendingDomain,
  WorkspaceSendingDomainStatus,
} from '@prisma/client'
import { sendingDomainNotFound, sendingDomainTaken } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'
import { isUniqueViolation } from './site.repository'

/**
 * Sending domains (ADR 0054). Pure Prisma access; the rules (who may, when
 * to re-check, what counts as "in use") live in `SendingDomainService`.
 */

/** Statuses re-checked every tick while the domain is young (first 72 h). */
export const FREQUENT_CHECK_STATUSES: WorkspaceSendingDomainStatus[] = [
  'NOT_STARTED',
  'PENDING',
  'TEMPORARY_FAILURE',
]

export interface DueForCheckWindow {
  /** Domains created after this are "young" (frequent re-checks). */
  youngSince: Date
  /** Young pending domains last checked before this are due. */
  frequentBefore: Date
  /** Everything else (verified, failed, old) last checked before this is due. */
  dailyBefore: Date
  limit: number
}

export interface ActiveNewsletterSender {
  sendingDomainId: string | null
  fromEmail: string
}

export const SendingDomainRepository = {
  async findVerifiedByName(
    workspaceId: string,
    name: string,
  ): Promise<Result<WorkspaceSendingDomain | null>> {
    try {
      const domain = await prisma.workspaceSendingDomain.findFirst({
        where: { workspaceId, name, status: 'VERIFIED' },
      })
      return ok(domain)
    } catch (error) {
      return err(dbError('Failed to find verified sending domain', error))
    }
  },

  async listByWorkspace(
    workspaceId: string,
  ): Promise<Result<WorkspaceSendingDomain[]>> {
    try {
      const domains = await prisma.workspaceSendingDomain.findMany({
        where: { workspaceId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
      return ok(domains)
    } catch (error) {
      return err(dbError('Failed to list sending domains', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<WorkspaceSendingDomain>> {
    try {
      const domain = await prisma.workspaceSendingDomain.findFirst({
        where: { id, workspaceId },
      })
      if (!domain) return err(sendingDomainNotFound())
      return ok(domain)
    } catch (error) {
      return err(dbError('Failed to find sending domain', error))
    }
  },

  /** Any workspace: names are unique across the platform. */
  async findByName(
    name: string,
  ): Promise<Result<WorkspaceSendingDomain | null>> {
    try {
      const domain = await prisma.workspaceSendingDomain.findUnique({
        where: { name },
      })
      return ok(domain)
    } catch (error) {
      return err(dbError('Failed to find sending domain by name', error))
    }
  },

  async create(data: {
    workspaceId: string
    createdById: string
    name: string
    region: string
    resendDomainId: string
    status: WorkspaceSendingDomainStatus
    records: Prisma.InputJsonValue
    verifiedAt?: Date | null
    lastCheckedAt?: Date | null
  }): Promise<Result<WorkspaceSendingDomain>> {
    try {
      const domain = await prisma.workspaceSendingDomain.create({ data })
      return ok(domain)
    } catch (error) {
      if (isUniqueViolation(error)) return err(sendingDomainTaken())
      return err(dbError('Failed to create sending domain', error))
    }
  },

  async updateCheck(
    id: string,
    data: {
      status: WorkspaceSendingDomainStatus
      records?: Prisma.InputJsonValue
      lastCheckedAt: Date
      verifiedAt?: Date | null
      failureReason?: string | null
    },
  ): Promise<Result<WorkspaceSendingDomain>> {
    try {
      const domain = await prisma.workspaceSendingDomain.update({
        where: { id },
        data,
      })
      return ok(domain)
    } catch (error) {
      return err(dbError('Failed to update sending domain check', error))
    }
  },

  async delete(id: string): Promise<Result<void>> {
    try {
      await prisma.workspaceSendingDomain.delete({ where: { id } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete sending domain', error))
    }
  },

  /** Sender of every ACTIVE (not deleted) newsletter of the workspace. */
  async listActiveNewsletterSenders(
    workspaceId: string,
  ): Promise<Result<ActiveNewsletterSender[]>> {
    try {
      const rows = await prisma.crmNewsletter.findMany({
        where: { workspaceId, status: 'ACTIVE', deletedAt: null },
        select: { sendingDomainId: true, fromEmail: true },
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list newsletter senders', error))
    }
  },

  /**
   * Domains the worker should re-check now, least recently checked first:
   * young domains still waiting for DNS every tick, everything else once a
   * day.
   */
  async listDueForCheck(
    window: DueForCheckWindow,
  ): Promise<Result<WorkspaceSendingDomain[]>> {
    try {
      const domains = await prisma.workspaceSendingDomain.findMany({
        where: {
          resendDomainId: { not: null },
          OR: [
            {
              status: { in: FREQUENT_CHECK_STATUSES },
              createdAt: { gte: window.youngSince },
              OR: [
                { lastCheckedAt: null },
                { lastCheckedAt: { lt: window.frequentBefore } },
              ],
            },
            {
              OR: [
                { status: { notIn: FREQUENT_CHECK_STATUSES } },
                { createdAt: { lt: window.youngSince } },
              ],
              AND: [
                {
                  OR: [
                    { lastCheckedAt: null },
                    { lastCheckedAt: { lt: window.dailyBefore } },
                  ],
                },
              ],
            },
          ],
        },
        orderBy: [{ lastCheckedAt: { sort: 'asc', nulls: 'first' } }],
        take: window.limit,
      })
      return ok(domains)
    } catch (error) {
      return err(dbError('Failed to list sending domains due for check', error))
    }
  },
}
