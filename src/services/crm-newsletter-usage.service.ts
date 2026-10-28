import { logger } from '@/lib/axiom/logger'
import { PLAN_CATALOG } from '@/src/config/plans'
import { notFound } from '@/src/errors'
import { recordAdminAction } from '@/src/lib/admin-audit'
import { err, ok, type Result } from '@/src/lib/result'
import { whatsappUsagePeriod } from '@/src/lib/whatsapp/usage-period'
import { toCrmNewsletterUsageDTO } from '@/src/mappers/crm-newsletter-issue.mapper'
import { CrmNewsletterUsageRepository } from '@/src/repositories/crm-newsletter-usage.repository'
import type {
  CrmNewsletterUsageDTO,
  UpdateCrmNewsletterSettingsDTO,
} from '@/src/schemas/crm-newsletter.schema'
import { assertModuleMember, assertPlatformAdmin } from './authz'
import { notifyNewsletterUsage } from './crm-newsletter-notifications'

/**
 * Monthly newsletter quota (ADR 0054): limit = the admin override of the
 * workspace, or the plan's `newsletterEmailsPerMonth` (null = unlimited).
 * The month is the São Paulo calendar month (same helper as the WhatsApp
 * limits). Test sends never reach `record`.
 */

/** Alert thresholds (% of the limit), notified once per month each. */
export const NEWSLETTER_USAGE_THRESHOLDS = [50, 80, 100] as const

/** `YYYY-MM` of the newsletter usage month (America/Sao_Paulo). */
export function newsletterUsageMonth(now: Date): string {
  return whatsappUsagePeriod(now)
}

/** Thresholds reached at `used` e-mails (each at `ceil(limit × pct / 100)`). */
export function reachedThresholds(used: number, limit: number): number[] {
  if (limit <= 0) return []
  return NEWSLETTER_USAGE_THRESHOLDS.filter(
    (threshold) => used >= Math.ceil((limit * threshold) / 100),
  )
}

export const CrmNewsletterUsageService = {
  /** The month's usage and limit of a workspace (no authorization). */
  async getUsage(
    workspaceId: string,
    now: Date,
  ): Promise<Result<CrmNewsletterUsageDTO>> {
    const month = newsletterUsageMonth(now)
    const [workspace, settings, usage] = await Promise.all([
      CrmNewsletterUsageRepository.findWorkspacePlan(workspaceId),
      CrmNewsletterUsageRepository.findSettings(workspaceId),
      CrmNewsletterUsageRepository.findUsage(workspaceId, month),
    ])
    if (!workspace.ok) return workspace
    if (!settings.ok) return settings
    if (!usage.ok) return usage
    if (!workspace.value) return err(notFound('Workspace'))
    return ok(
      toCrmNewsletterUsageDTO({
        month,
        usage: usage.value,
        settings: settings.value,
        planLimit:
          PLAN_CATALOG[workspace.value.activePlan].limits
            .newsletterEmailsPerMonth,
      }),
    )
  },

  /** E-mails still allowed this month; `null` = unlimited. */
  remaining(usage: CrmNewsletterUsageDTO): number | null {
    if (usage.limit === null) return null
    return Math.max(0, usage.limit - usage.emailsSent)
  },

  /** Ajustes da newsletter: any CRM member who can see e-mail marketing. */
  async forMember(
    actorId: string,
    workspaceId: string,
    now: Date,
  ): Promise<Result<CrmNewsletterUsageDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'email',
      action: 'VIEW',
    })
    if (!membership.ok) return membership
    return CrmNewsletterUsageService.getUsage(workspaceId, now)
  },

  /**
   * Adds `count` sent e-mails to the month and sends the 50/80/100 %
   * notices that this move reached (each claimed once per month). Never
   * fails the caller for a notice: only the counter write is an error.
   */
  async record(
    workspaceId: string,
    count: number,
    now: Date,
  ): Promise<Result<CrmNewsletterUsageDTO>> {
    const month = newsletterUsageMonth(now)
    const incremented = await CrmNewsletterUsageRepository.increment(
      workspaceId,
      month,
      count,
    )
    if (!incremented.ok) return incremented
    const usage = await CrmNewsletterUsageService.getUsage(workspaceId, now)
    if (!usage.ok) return usage

    const { limit, emailsSent } = usage.value
    if (limit === null) return usage
    const pending = reachedThresholds(emailsSent, limit).filter(
      (threshold) => !incremented.value.notifiedThresholds.includes(threshold),
    )
    // Only the highest new threshold is announced; lower ones are claimed
    // silently so a big batch does not post 50 % and 80 % at once.
    for (const threshold of pending) {
      const claimed = await CrmNewsletterUsageRepository.claimThreshold(
        workspaceId,
        month,
        threshold,
      )
      if (!claimed.ok || !claimed.value) continue
      if (threshold !== pending[pending.length - 1]) continue
      logger.info('crm.newsletter.usage_threshold', {
        component: 'CrmNewsletterUsageService',
        workspaceId,
        month,
        threshold,
        used: emailsSent,
        limit,
      })
      await notifyNewsletterUsage({
        workspaceId,
        month,
        threshold,
        used: emailsSent,
        limit,
      })
    }
    return usage
  },

  // ─── Platform admin ───────────────────────────────────────────────────────

  async adminGet(
    actorId: string,
    workspaceId: string,
    now: Date,
  ): Promise<Result<CrmNewsletterUsageDTO>> {
    const admin = await assertPlatformAdmin(actorId)
    if (!admin.ok) return admin
    return CrmNewsletterUsageService.getUsage(workspaceId, now)
  },

  async adminUpdate(
    actorId: string,
    workspaceId: string,
    input: UpdateCrmNewsletterSettingsDTO,
    now: Date,
  ): Promise<Result<CrmNewsletterUsageDTO>> {
    const admin = await assertPlatformAdmin(actorId)
    if (!admin.ok) return admin
    const workspace =
      await CrmNewsletterUsageRepository.findWorkspacePlan(workspaceId)
    if (!workspace.ok) return workspace
    if (!workspace.value) return err(notFound('Workspace'))

    const saved = await CrmNewsletterUsageRepository.upsertSettings(
      workspaceId,
      {
        monthlyEmailLimitOverride: input.monthlyEmailLimitOverride,
        updatedById: admin.value.userId,
      },
    )
    if (!saved.ok) return saved

    await recordAdminAction({
      actor: admin.value,
      action: 'crm_newsletter.limit_override',
      audit: { entity: 'crm_newsletter_settings', action: 'update' },
      targetType: 'workspace',
      targetId: workspaceId,
      targetLabel: workspace.value.slug,
      meta: { monthlyEmailLimitOverride: input.monthlyEmailLimitOverride },
    })
    return CrmNewsletterUsageService.getUsage(workspaceId, now)
  },
}
