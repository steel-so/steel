import {
  type CrmNewsletterDelayUnit,
  type CrmNewsletterWelcomeDelivery,
  type CrmNewsletterWelcomeStep,
  Prisma,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import {
  CRM_NEWSLETTER_WELCOME_STALE_DAYS,
  type CrmNewsletterWelcomeStepStatsDTO,
} from '@/src/schemas/crm-newsletter-automation.schema'
import type { NewsletterWithWorkspace } from './crm-newsletter-issue.repository'
import { dbError } from './db-error'

/**
 * Welcome series of the newsletter (slice nl2-automation): the steps
 * (CRUD + order) and the per-subscriber progress rows. A progress row is
 * created already claimed (SENDING) by `claimDue`; the unique
 * (step, subscriber) key makes two ticks never send the same step twice.
 */

export type ClaimedWelcomeDelivery = Pick<
  CrmNewsletterWelcomeDelivery,
  'id' | 'stepId' | 'subscriberId' | 'email'
> & { name: string | null; personId: string | null; subscriberStatus: string }

export type WelcomeDeliveryMark =
  | 'deliveredAt'
  | 'openedAt'
  | 'clickedAt'
  | 'bouncedAt'
  | 'complainedAt'

const EMPTY_STATS: CrmNewsletterWelcomeStepStatsDTO = {
  sent: 0,
  opened: 0,
  clicked: 0,
}

export const CrmNewsletterWelcomeRepository = {
  // ─── Steps ──────────────────────────────────────────────────────────────

  async listSteps(
    newsletterId: string,
  ): Promise<Result<CrmNewsletterWelcomeStep[]>> {
    try {
      const steps = await prisma.crmNewsletterWelcomeStep.findMany({
        where: { newsletterId },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      })
      return ok(steps)
    } catch (error) {
      return err(dbError('Failed to list CRM newsletter welcome steps', error))
    }
  },

  async findStep(
    newsletterId: string,
    stepId: string,
  ): Promise<Result<CrmNewsletterWelcomeStep | null>> {
    try {
      const step = await prisma.crmNewsletterWelcomeStep.findFirst({
        where: { id: stepId, newsletterId },
      })
      return ok(step)
    } catch (error) {
      return err(dbError('Failed to find CRM newsletter welcome step', error))
    }
  },

  async findStepsByIds(
    ids: string[],
  ): Promise<Result<CrmNewsletterWelcomeStep[]>> {
    if (ids.length === 0) return ok([])
    try {
      const steps = await prisma.crmNewsletterWelcomeStep.findMany({
        where: { id: { in: ids } },
      })
      return ok(steps)
    } catch (error) {
      return err(dbError('Failed to load CRM newsletter welcome steps', error))
    }
  },

  async countSteps(newsletterId: string): Promise<Result<number>> {
    try {
      const count = await prisma.crmNewsletterWelcomeStep.count({
        where: { newsletterId },
      })
      return ok(count)
    } catch (error) {
      return err(dbError('Failed to count CRM newsletter welcome steps', error))
    }
  },

  /** Appends the step at the end of the series. */
  async createStep(input: {
    newsletterId: string
    workspaceId: string
    subject: string
    preheader: string | null
    delayValue: number
    delayUnit: CrmNewsletterDelayUnit
    builderDocument: Prisma.InputJsonValue
    createdById: string
  }): Promise<Result<CrmNewsletterWelcomeStep>> {
    try {
      const step = await prisma.$transaction(async (tx) => {
        const last = await tx.crmNewsletterWelcomeStep.aggregate({
          where: { newsletterId: input.newsletterId },
          _max: { position: true },
        })
        return tx.crmNewsletterWelcomeStep.create({
          data: { ...input, position: (last._max.position ?? -1) + 1 },
        })
      })
      return ok(step)
    } catch (error) {
      return err(dbError('Failed to create CRM newsletter welcome step', error))
    }
  },

  async updateStep(
    stepId: string,
    data: Prisma.CrmNewsletterWelcomeStepUncheckedUpdateInput,
  ): Promise<Result<CrmNewsletterWelcomeStep>> {
    try {
      const step = await prisma.crmNewsletterWelcomeStep.update({
        where: { id: stepId },
        data,
      })
      return ok(step)
    } catch (error) {
      return err(dbError('Failed to update CRM newsletter welcome step', error))
    }
  },

  /** Deletes the step (its progress rows cascade) and closes the gap. */
  async deleteStep(
    newsletterId: string,
    stepId: string,
  ): Promise<Result<void>> {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.crmNewsletterWelcomeStep.delete({ where: { id: stepId } })
        const rest = await tx.crmNewsletterWelcomeStep.findMany({
          where: { newsletterId },
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
          select: { id: true },
        })
        for (const [position, step] of rest.entries()) {
          await tx.crmNewsletterWelcomeStep.update({
            where: { id: step.id },
            data: { position },
          })
        }
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete CRM newsletter welcome step', error))
    }
  },

  /** `ids` in the new order (the caller checked they are all the steps). */
  async reorderSteps(ids: string[]): Promise<Result<void>> {
    try {
      await prisma.$transaction(
        ids.map((id, position) =>
          prisma.crmNewsletterWelcomeStep.update({
            where: { id },
            data: { position },
          }),
        ),
      )
      return ok(undefined)
    } catch (error) {
      return err(
        dbError('Failed to reorder CRM newsletter welcome steps', error),
      )
    }
  },

  /** sent / unique opens / unique clicks per step (missing = no rows). */
  async statsFor(
    stepIds: string[],
  ): Promise<Result<Map<string, CrmNewsletterWelcomeStepStatsDTO>>> {
    const stats = new Map<string, CrmNewsletterWelcomeStepStatsDTO>()
    if (stepIds.length === 0) return ok(stats)
    try {
      const rows = await prisma.$queryRaw<
        { step_id: string; sent: bigint; opened: bigint; clicked: bigint }[]
      >`
        SELECT step_id,
          COUNT(*) FILTER (WHERE status = 'SENT')::bigint AS sent,
          COUNT(opened_at)::bigint AS opened,
          COUNT(clicked_at)::bigint AS clicked
        FROM crm_newsletter_welcome_deliveries
        WHERE step_id IN (${Prisma.join(stepIds)})
        GROUP BY step_id`
      for (const row of rows) {
        stats.set(row.step_id, {
          ...EMPTY_STATS,
          sent: Number(row.sent),
          opened: Number(row.opened),
          clicked: Number(row.clicked),
        })
      }
      return ok(stats)
    } catch (error) {
      return err(
        dbError('Failed to compute CRM newsletter welcome stats', error),
      )
    }
  },

  // ─── Worker ─────────────────────────────────────────────────────────────

  /** ACTIVE newsletters with at least one enabled step. */
  async listNewslettersWithSeries(): Promise<
    Result<NewsletterWithWorkspace[]>
  > {
    try {
      const newsletters = await prisma.crmNewsletter.findMany({
        where: {
          status: 'ACTIVE',
          deletedAt: null,
          welcomeSteps: { some: { enabled: true } },
        },
        include: { workspace: { select: { slug: true, name: true } } },
        orderBy: { id: 'asc' },
      })
      return ok(newsletters)
    } catch (error) {
      return err(
        dbError('Failed to list CRM newsletters with a welcome series', error),
      )
    }
  },

  /**
   * Claims up to `limit` sends of the newsletter: first the rows left in
   * SENDING since before `stuckBefore` (worker died; the Resend
   * idempotency key keeps a resend from duplicating), then new rows for
   * every (enabled step × subscriber) that became due — ACTIVE, not
   * imported, confirmed, `confirmedAt + delay ≤ now`, not stale and not in
   * the workspace opt-out.
   */
  async claimDue(
    newsletterId: string,
    now: Date,
    stuckBefore: Date,
    limit: number,
  ): Promise<Result<ClaimedWelcomeDelivery[]>> {
    if (limit <= 0) return ok([])
    const staleSince = new Date(
      now.getTime() - CRM_NEWSLETTER_WELCOME_STALE_DAYS * 24 * 60 * 60 * 1000,
    )
    try {
      const reclaimed = await prisma.$queryRaw<{ id: string }[]>`
        UPDATE crm_newsletter_welcome_deliveries
        SET updated_at = NOW()
        WHERE id IN (
          SELECT id FROM crm_newsletter_welcome_deliveries
          WHERE newsletter_id = ${newsletterId}
            AND status = 'SENDING'::"CrmNewsletterDeliveryStatus"
            AND updated_at < ${stuckBefore}
          ORDER BY created_at, id
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id`
      const room = limit - reclaimed.length
      const created =
        room > 0
          ? await prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO crm_newsletter_welcome_deliveries
          (id, step_id, newsletter_id, workspace_id, subscriber_id, email,
           status, created_at, updated_at)
        SELECT gen_random_uuid()::text, st.id, st.newsletter_id,
               st.workspace_id, s.id, s.email,
               'SENDING'::"CrmNewsletterDeliveryStatus", NOW(), NOW()
        FROM crm_newsletter_welcome_steps st
        JOIN crm_newsletter_subscribers s ON s.newsletter_id = st.newsletter_id
        CROSS JOIN LATERAL (
          SELECT s.confirmed_at + make_interval(hours =>
            CASE WHEN st.delay_unit = 'DAYS'::"CrmNewsletterDelayUnit"
              THEN st.delay_value * 24 ELSE st.delay_value END) AS due_at
        ) due
        WHERE st.newsletter_id = ${newsletterId}
          AND st.enabled
          AND s.status = 'ACTIVE'::"CrmNewsletterSubscriberStatus"
          AND s.source <> 'IMPORT'::"CrmNewsletterSubscriberSource"
          AND s.confirmed_at IS NOT NULL
          AND due.due_at <= ${now}
          AND due.due_at > ${staleSince}
          AND NOT EXISTS (
            SELECT 1 FROM crm_newsletter_welcome_deliveries d
            WHERE d.step_id = st.id AND d.subscriber_id = s.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM crm_email_opt_outs o
            WHERE o.workspace_id = s.workspace_id AND o.email = s.email
          )
        ORDER BY due.due_at, st.position, s.id
        LIMIT ${room}
        ON CONFLICT (step_id, subscriber_id) DO NOTHING
        RETURNING id`
          : []
      const ids = [...reclaimed, ...created].map((row) => row.id)
      if (ids.length === 0) return ok([])
      const rows = await prisma.crmNewsletterWelcomeDelivery.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          stepId: true,
          subscriberId: true,
          email: true,
          subscriber: {
            select: { name: true, personId: true, status: true },
          },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
      return ok(
        rows.map(({ subscriber, ...row }) => ({
          ...row,
          name: subscriber.name,
          personId: subscriber.personId,
          subscriberStatus: subscriber.status,
        })),
      )
    } catch (error) {
      return err(dbError('Failed to claim CRM newsletter welcome sends', error))
    }
  },

  /** Records the provider ids and stamps the subscribers' `lastSentAt`. */
  async markSent(
    sent: { id: string; subscriberId: string; providerMessageId: string }[],
    now: Date,
  ): Promise<Result<void>> {
    if (sent.length === 0) return ok(undefined)
    try {
      await prisma.$transaction([
        ...sent.map((row) =>
          prisma.crmNewsletterWelcomeDelivery.updateMany({
            where: { id: row.id, status: 'SENDING' },
            data: {
              status: 'SENT',
              providerMessageId: row.providerMessageId,
              sentAt: now,
              error: null,
            },
          }),
        ),
        prisma.crmNewsletterSubscriber.updateMany({
          where: { id: { in: sent.map((row) => row.subscriberId) } },
          data: { lastSentAt: now },
        }),
      ])
      return ok(undefined)
    } catch (error) {
      return err(
        dbError('Failed to record CRM newsletter welcome sends', error),
      )
    }
  },

  async markFailed(ids: string[], error: string): Promise<Result<void>> {
    if (ids.length === 0) return ok(undefined)
    try {
      await prisma.crmNewsletterWelcomeDelivery.updateMany({
        where: { id: { in: ids }, status: 'SENDING' },
        data: { status: 'FAILED', error: error.slice(0, 500) },
      })
      return ok(undefined)
    } catch (cause) {
      return err(dbError('Failed to fail CRM newsletter welcome sends', cause))
    }
  },

  async markSkipped(ids: string[], reason: string): Promise<Result<void>> {
    if (ids.length === 0) return ok(undefined)
    try {
      await prisma.crmNewsletterWelcomeDelivery.updateMany({
        where: { id: { in: ids }, status: 'SENDING' },
        data: { status: 'SKIPPED', skipReason: reason },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to skip CRM newsletter welcome sends', error))
    }
  },

  /**
   * Gives claimed rows back after a transient provider failure: they stay
   * SENDING with an old `updated_at`, so the next tick reclaims them.
   */
  async release(ids: string[]): Promise<Result<void>> {
    if (ids.length === 0) return ok(undefined)
    try {
      await prisma.crmNewsletterWelcomeDelivery.updateMany({
        where: { id: { in: ids }, status: 'SENDING' },
        data: { updatedAt: new Date(0) },
      })
      return ok(undefined)
    } catch (error) {
      return err(
        dbError('Failed to release CRM newsletter welcome sends', error),
      )
    }
  },

  // ─── Webhook ──────────────────────────────────────────────────────────────

  async findByProviderMessageId(
    providerMessageId: string,
  ): Promise<Result<CrmNewsletterWelcomeDelivery | null>> {
    try {
      const row = await prisma.crmNewsletterWelcomeDelivery.findUnique({
        where: { providerMessageId },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find CRM newsletter welcome send', error))
    }
  },

  /** Sets `field` only the first time; `true` when it changed. */
  async markFirst(
    id: string,
    field: WelcomeDeliveryMark,
    at: Date,
  ): Promise<Result<boolean>> {
    try {
      const updated = await prisma.crmNewsletterWelcomeDelivery.updateMany({
        where: { id, [field]: null },
        data: { [field]: at },
      })
      return ok(updated.count === 1)
    } catch (error) {
      return err(dbError('Failed to mark CRM newsletter welcome send', error))
    }
  },

  /** Stores one click with its URL (slice nl3-welcome-bridge). */
  async recordClick(input: {
    deliveryId: string
    stepId: string
    url: string
    clickedAt: Date
  }): Promise<Result<void>> {
    try {
      await prisma.crmNewsletterWelcomeLinkClick.create({ data: input })
      return ok(undefined)
    } catch (error) {
      return err(
        dbError('Failed to record CRM newsletter welcome click', error),
      )
    }
  },
}
