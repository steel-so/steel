import type {
  CrmNewsletterSettings,
  CrmNewsletterUsageMonthly,
  Plan,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/**
 * Monthly newsletter quota (ADR 0054): the per-workspace admin override,
 * the e-mails-sent counter per São Paulo month and the thresholds already
 * notified.
 */
export const CrmNewsletterUsageRepository = {
  async findWorkspacePlan(
    workspaceId: string,
  ): Promise<Result<{ activePlan: Plan; slug: string } | null>> {
    try {
      const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { activePlan: true, slug: true },
      })
      return ok(workspace)
    } catch (error) {
      return err(dbError('Failed to read workspace plan', error))
    }
  },

  async findSettings(
    workspaceId: string,
  ): Promise<Result<CrmNewsletterSettings | null>> {
    try {
      const settings = await prisma.crmNewsletterSettings.findUnique({
        where: { workspaceId },
      })
      return ok(settings)
    } catch (error) {
      return err(dbError('Failed to read CRM newsletter settings', error))
    }
  },

  async upsertSettings(
    workspaceId: string,
    data: { monthlyEmailLimitOverride: number | null; updatedById: string },
  ): Promise<Result<CrmNewsletterSettings>> {
    try {
      const settings = await prisma.crmNewsletterSettings.upsert({
        where: { workspaceId },
        create: { workspaceId, ...data },
        update: data,
      })
      return ok(settings)
    } catch (error) {
      return err(dbError('Failed to save CRM newsletter settings', error))
    }
  },

  async findUsage(
    workspaceId: string,
    month: string,
  ): Promise<Result<CrmNewsletterUsageMonthly | null>> {
    try {
      const usage = await prisma.crmNewsletterUsageMonthly.findUnique({
        where: { workspaceId_month: { workspaceId, month } },
      })
      return ok(usage)
    } catch (error) {
      return err(dbError('Failed to read CRM newsletter usage', error))
    }
  },

  /** Adds `count` e-mails to the month (atomic increment). */
  async increment(
    workspaceId: string,
    month: string,
    count: number,
  ): Promise<Result<CrmNewsletterUsageMonthly>> {
    try {
      const usage = await prisma.crmNewsletterUsageMonthly.upsert({
        where: { workspaceId_month: { workspaceId, month } },
        create: { workspaceId, month, emailsSent: count },
        update: { emailsSent: { increment: count } },
      })
      return ok(usage)
    } catch (error) {
      return err(dbError('Failed to increment CRM newsletter usage', error))
    }
  },

  /**
   * Records `threshold` as notified for the month. `false` when it already
   * was (another worker got there first), so each notice goes out once.
   */
  async claimThreshold(
    workspaceId: string,
    month: string,
    threshold: number,
  ): Promise<Result<boolean>> {
    try {
      const updated = await prisma.$executeRaw`
        UPDATE crm_newsletter_usage_monthly
        SET notified_thresholds = array_append(notified_thresholds, ${threshold}::int),
            updated_at = NOW()
        WHERE workspace_id = ${workspaceId} AND month = ${month}
          AND NOT (${threshold}::int = ANY(notified_thresholds))`
      return ok(updated === 1)
    } catch (error) {
      return err(dbError('Failed to record CRM newsletter usage notice', error))
    }
  },
}
