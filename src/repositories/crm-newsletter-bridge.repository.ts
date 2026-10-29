import {
  type CrmNewsletterStatus,
  type CrmNewsletterSubscriber,
  type CrmNewsletterSubscriberStatus,
  Prisma,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/**
 * Data access of the newsletter ↔ CRM bridge (ADR 0054 phase 2): who the
 * subscriber is in the CRM, the timeline dedupe, the leads linked to a
 * person/e-mail, the engagement points (one row per rule × lead × event) and
 * the newsletter subscriptions shown on the person page.
 */

export type BridgeSubscriber = Pick<
  CrmNewsletterSubscriber,
  'id' | 'workspaceId' | 'newsletterId' | 'email' | 'name' | 'personId'
> & {
  status: CrmNewsletterSubscriberStatus
  newsletter: { id: string; name: string }
}

export type BridgeIssue = {
  id: string
  subject: string
  number: number | null
}

/** A welcome series e-mail; `position` is 1-based (as shown to people). */
export type BridgeWelcomeStep = {
  id: string
  subject: string
  position: number
}

/** Welcome series engagement of one subscriber (person card). */
export type SubscriberWelcomeStats = {
  sent: number
  opened: number
  clicked: number
}

export type PersonSubscriptionRow = CrmNewsletterSubscriber & {
  newsletter: { id: string; name: string; status: CrmNewsletterStatus }
}

export const CrmNewsletterBridgeRepository = {
  async findSubscriber(
    subscriberId: string,
  ): Promise<Result<BridgeSubscriber | null>> {
    try {
      const row = await prisma.crmNewsletterSubscriber.findUnique({
        where: { id: subscriberId },
        select: {
          id: true,
          workspaceId: true,
          newsletterId: true,
          email: true,
          name: true,
          personId: true,
          status: true,
          newsletter: { select: { id: true, name: true } },
        },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to load the newsletter subscriber', error))
    }
  },

  async findIssue(issueId: string): Promise<Result<BridgeIssue | null>> {
    try {
      const issue = await prisma.crmNewsletterIssue.findUnique({
        where: { id: issueId },
        select: { id: true, subject: true, number: true },
      })
      return ok(issue)
    } catch (error) {
      return err(dbError('Failed to load the newsletter issue', error))
    }
  },

  async findWelcomeStep(
    stepId: string,
  ): Promise<Result<BridgeWelcomeStep | null>> {
    try {
      const step = await prisma.crmNewsletterWelcomeStep.findUnique({
        where: { id: stepId },
        select: { id: true, subject: true, position: true },
      })
      return ok(step ? { ...step, position: step.position + 1 } : null)
    } catch (error) {
      return err(dbError('Failed to load the newsletter welcome step', error))
    }
  },

  /** Clicks of this welcome delivery on this URL (the current one included). */
  async countWelcomeClicks(
    deliveryId: string,
    url: string,
  ): Promise<Result<number>> {
    try {
      const count = await prisma.crmNewsletterWelcomeLinkClick.count({
        where: { deliveryId, url },
      })
      return ok(count)
    } catch (error) {
      return err(dbError('Failed to count newsletter welcome clicks', error))
    }
  },

  /** sent / opened / clicked welcome e-mails per subscriber. */
  async welcomeStatsBySubscriber(
    subscriberIds: string[],
  ): Promise<Result<Map<string, SubscriberWelcomeStats>>> {
    const stats = new Map<string, SubscriberWelcomeStats>()
    if (subscriberIds.length === 0) return ok(stats)
    try {
      const rows = await prisma.$queryRaw<
        {
          subscriber_id: string
          sent: bigint
          opened: bigint
          clicked: bigint
        }[]
      >`
        SELECT subscriber_id,
          COUNT(*) FILTER (WHERE status = 'SENT')::bigint AS sent,
          COUNT(opened_at)::bigint AS opened,
          COUNT(clicked_at)::bigint AS clicked
        FROM crm_newsletter_welcome_deliveries
        WHERE subscriber_id IN (${Prisma.join(subscriberIds)})
        GROUP BY subscriber_id`
      for (const row of rows) {
        stats.set(row.subscriber_id, {
          sent: Number(row.sent),
          opened: Number(row.opened),
          clicked: Number(row.clicked),
        })
      }
      return ok(stats)
    } catch (error) {
      return err(dbError('Failed to compute the welcome series stats', error))
    }
  },

  /** Oldest live CRM person of the workspace with this e-mail. */
  async findPersonIdByEmail(
    workspaceId: string,
    email: string,
  ): Promise<Result<string | null>> {
    try {
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT p.id FROM crm_people p
        WHERE p.workspace_id = ${workspaceId}
          AND p.deleted_at IS NULL
          AND EXISTS (
            SELECT 1 FROM unnest(p.emails) e
            WHERE lower(trim(e)) = ${email.trim().toLowerCase()}
          )
        ORDER BY p.created_at ASC
        LIMIT 1`
      return ok(rows[0]?.id ?? null)
    } catch (error) {
      return err(dbError('Failed to match a CRM person by e-mail', error))
    }
  },

  /** Whether the timeline already has this event of this record. */
  async hasActivity(input: {
    workspaceId: string
    personId: string
    action: string
    entityId: string
  }): Promise<Result<boolean>> {
    try {
      const found = await prisma.crmActivity.findFirst({
        where: input,
        select: { id: true },
      })
      return ok(found !== null)
    } catch (error) {
      return err(dbError('Failed to look up a CRM activity', error))
    }
  },

  /** Live leads converted into the person or carrying the e-mail. */
  async findLinkedLeadIds(
    workspaceId: string,
    personId: string | null,
    email: string,
  ): Promise<Result<string[]>> {
    try {
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT l.id FROM crm_leads l
        WHERE l.workspace_id = ${workspaceId}
          AND l.deleted_at IS NULL
          AND (
            (${personId}::text IS NOT NULL AND l.converted_person_id = ${personId})
            OR EXISTS (
              SELECT 1 FROM unnest(l.emails) e
              WHERE lower(trim(e)) = ${email.trim().toLowerCase()}
            )
          )
        ORDER BY l.created_at ASC`
      return ok(rows.map((row) => row.id))
    } catch (error) {
      return err(dbError('Failed to find the leads of a contact', error))
    }
  },

  /**
   * Awards the points of one rule for one event, once: the unique
   * (rule, lead, event key) row is the idempotency guard. `true` when the
   * points were added now.
   */
  async awardScoreEvent(input: {
    workspaceId: string
    leadId: string
    ruleId: string
    eventKey: string
    points: number
  }): Promise<Result<boolean>> {
    try {
      const awarded = await prisma.$transaction(async (tx) => {
        const created = await tx.crmLeadScoreEvent.createMany({
          data: [input],
          skipDuplicates: true,
        })
        if (created.count === 0) return false
        if (input.points !== 0) {
          await tx.crmLead.update({
            where: { id: input.leadId },
            data: { score: { increment: input.points } },
          })
        }
        return true
      })
      return ok(awarded)
    } catch (error) {
      return err(dbError('Failed to award lead engagement points', error))
    }
  },

  /** Clicks of this recipient on this URL (the current one included). */
  async countClicks(recipientId: string, url: string): Promise<Result<number>> {
    try {
      const count = await prisma.crmNewsletterLinkClick.count({
        where: { recipientId, url },
      })
      return ok(count)
    } catch (error) {
      return err(dbError('Failed to count newsletter link clicks', error))
    }
  },

  async findPerson(
    workspaceId: string,
    personId: string,
  ): Promise<Result<{ id: string; name: string; emails: string[] } | null>> {
    try {
      const person = await prisma.crmPerson.findFirst({
        where: { id: personId, workspaceId, deletedAt: null },
        select: { id: true, name: true, emails: true },
      })
      return ok(person)
    } catch (error) {
      return err(dbError('Failed to load the CRM person', error))
    }
  },

  /** Subscriptions linked to the person or to one of their e-mails. */
  async listPersonSubscriptions(
    workspaceId: string,
    personId: string,
    emails: string[],
  ): Promise<Result<PersonSubscriptionRow[]>> {
    try {
      const rows = await prisma.crmNewsletterSubscriber.findMany({
        where: {
          workspaceId,
          newsletter: { deletedAt: null },
          OR: [
            { personId },
            ...(emails.length > 0 ? [{ email: { in: emails } }] : []),
          ],
        },
        include: {
          newsletter: { select: { id: true, name: true, status: true } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list the newsletters of a person', error))
    }
  },

  async listActiveNewsletters(
    workspaceId: string,
  ): Promise<Result<{ id: string; name: string }[]>> {
    try {
      const rows = await prisma.crmNewsletter.findMany({
        where: { workspaceId, deletedAt: null, status: 'ACTIVE' },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list the active newsletters', error))
    }
  },

  async findSubscription(
    workspaceId: string,
    subscriberId: string,
  ): Promise<Result<PersonSubscriptionRow | null>> {
    try {
      const row = await prisma.crmNewsletterSubscriber.findFirst({
        where: {
          id: subscriberId,
          workspaceId,
          newsletter: { deletedAt: null },
        },
        include: {
          newsletter: { select: { id: true, name: true, status: true } },
        },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to load the newsletter subscription', error))
    }
  },

  /** Member unsubscribe: only a subscribed (ACTIVE/PENDING) row moves. */
  async unsubscribe(
    subscriberId: string,
    reason: string,
    at: Date,
  ): Promise<Result<boolean>> {
    try {
      const updated = await prisma.crmNewsletterSubscriber.updateMany({
        where: { id: subscriberId, status: { in: ['ACTIVE', 'PENDING'] } },
        data: {
          status: 'UNSUBSCRIBED',
          unsubscribedAt: at,
          unsubscribeReason: reason,
        },
      })
      return ok(updated.count === 1)
    } catch (error) {
      return err(
        dbError('Failed to unsubscribe the newsletter subscriber', error),
      )
    }
  },
}
