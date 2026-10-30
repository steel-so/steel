import { Prisma } from '@prisma/client'
import type {
  CustomerHealthSignals,
  OpportunityHealthSignals,
} from '@/src/lib/crm-health'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { normalizeDocument } from '@/src/lib/servicedesk/document'
import { dbError } from './db-error'

/**
 * Collects the raw signals the health scores are computed from. Read-only:
 * every method answers "what is true about this company / deal right now".
 * The scoring itself is the pure lib in `src/lib/crm-health`.
 */

const DAY_MS = 86_400_000
/** Window of the WhatsApp sentiment and of the ServiceDesk breach count. */
const RECENT_DAYS = 90
/** Window of lost / won deals and of CSAT answers. */
const LONG_DAYS = 180
/** A conversation whose average sentiment is below this is "negative". */
const NEGATIVE_SENTIMENT = -0.3
const TICKET_LIMIT = 500

const maxDate = (...dates: (Date | null | undefined)[]): Date | null => {
  let best: Date | null = null
  for (const date of dates) {
    if (date && (!best || date.getTime() > best.getTime())) best = date
  }
  return best
}

/**
 * SQL that turns a phone (CRM person phones are free text, WhatsApp ids are
 * digits) into the key "DDD + last 8 digits", the same match the phone-call
 * linking uses (`PhoneCallLinkRepository.findPersonByPhoneKey`).
 */
const NATIONAL = (column: Prisma.Sql) => Prisma.sql`
  CASE
    WHEN regexp_replace(${column}, '\\D', '', 'g') LIKE '55%'
      AND length(regexp_replace(${column}, '\\D', '', 'g')) IN (12, 13)
    THEN substr(regexp_replace(${column}, '\\D', '', 'g'), 3)
    ELSE regexp_replace(${column}, '\\D', '', 'g')
  END`

const KEY = (column: Prisma.Sql) => Prisma.sql`
  left(${NATIONAL(column)}, 2) || right(${NATIONAL(column)}, 8)`

interface ZapRow {
  conversations: number
  recent: number
  scored: number
  avg_sentiment: number | null
  negative: number
  last_message_at: Date | null
}

/** Conversations of the contacts whose phone matches one of `personFilter`. */
async function zapStats(
  workspaceId: string,
  personFilter: Prisma.Sql,
  now: Date,
): Promise<ZapRow> {
  const since = new Date(now.getTime() - RECENT_DAYS * DAY_MS)
  const rows = await prisma.$queryRaw<ZapRow[]>(Prisma.sql`
    WITH person_keys AS (
      SELECT DISTINCT ${KEY(Prisma.sql`phone`)} AS k
      FROM crm_people p, unnest(p.phones) AS phone
      WHERE p.workspace_id = ${workspaceId}
        AND p.deleted_at IS NULL
        AND ${personFilter}
    )
    SELECT
      count(c.id)::int AS conversations,
      count(c.id) FILTER (WHERE c.last_message_at >= ${since})::int AS recent,
      count(c.avg_sentiment_score)
        FILTER (WHERE c.last_message_at >= ${since})::int AS scored,
      avg(c.avg_sentiment_score)
        FILTER (WHERE c.last_message_at >= ${since})::float AS avg_sentiment,
      count(c.id) FILTER (
        WHERE c.last_message_at >= ${since}
          AND c.avg_sentiment_score < ${NEGATIVE_SENTIMENT}
      )::int AS negative,
      max(c.last_message_at) AS last_message_at
    FROM whatsapp_conversations c
    JOIN whatsapp_contacts w ON w.id = c.contact_id
    WHERE c.workspace_id = ${workspaceId}
      AND c.deleted_at IS NULL
      AND length(${NATIONAL(Prisma.sql`w.wa_id`)}) IN (10, 11)
      AND ${KEY(Prisma.sql`w.wa_id`)} IN (SELECT k FROM person_keys)
  `)
  return rows[0] as ZapRow
}

/**
 * ServiceDesk side of a company: tickets of the SD customers that match its
 * CNPJ (or, failing that, its exact name). `null` when none matches.
 */
async function serviceDeskSignals(
  workspaceId: string,
  company: { name: string; cnpj: string | null },
  recent: Date,
  long: Date,
): Promise<Result<CustomerHealthSignals['sd']>> {
  try {
    const document = company.cnpj ? normalizeDocument(company.cnpj) : ''
    const matchers: Prisma.SdCustomerWhereInput[] = []
    if (document) matchers.push({ document })
    if (company.name.trim()) {
      matchers.push({
        name: { equals: company.name.trim(), mode: 'insensitive' },
      })
    }
    if (matchers.length === 0) return ok(null)

    const customers = await prisma.sdCustomer.findMany({
      where: { workspaceId, deletedAt: null, OR: matchers },
      select: { id: true },
    })
    if (customers.length === 0) return ok(null)
    const ids = customers.map((customer) => customer.id)

    const tickets = await prisma.sdTicket.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        OR: [{ customerId: { in: ids } }, { companyId: { in: ids } }],
        AND: [
          {
            OR: [
              { createdAt: { gte: long } },
              { closedAt: null, resolvedAt: null },
            ],
          },
        ],
      },
      select: {
        createdAt: true,
        closedAt: true,
        resolvedAt: true,
        resolutionBreached: true,
        firstResponseBreached: true,
        csatScore: true,
        riskPrediction: { select: { level: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: TICKET_LIMIT,
    })

    let openTickets = 0
    let highRiskOpenTickets = 0
    let tickets90d = 0
    let breachedTickets90d = 0
    let csatSum = 0
    let csatCount = 0
    for (const ticket of tickets) {
      const open = ticket.closedAt === null && ticket.resolvedAt === null
      if (open) {
        openTickets++
        if (ticket.riskPrediction?.level === 'HIGH') highRiskOpenTickets++
      }
      if (ticket.createdAt >= recent) {
        tickets90d++
        if (ticket.resolutionBreached || ticket.firstResponseBreached) {
          breachedTickets90d++
        }
      }
      if (ticket.csatScore !== null) {
        csatSum += ticket.csatScore
        csatCount++
      }
    }
    return ok({
      openTickets,
      breachedTickets90d,
      tickets90d,
      csatAvg: csatCount > 0 ? csatSum / csatCount : null,
      csatCount,
      highRiskOpenTickets,
    })
  } catch (error) {
    return err(dbError('Failed to collect the ServiceDesk signals', error))
  }
}

export const CrmHealthSignalsRepository = {
  /** Signals of a company (T4). */
  async customerSignals(
    workspaceId: string,
    company: {
      id: string
      name: string
      cnpj: string | null
      createdAt: Date
    },
    now: Date,
  ): Promise<Result<CustomerHealthSignals>> {
    try {
      const companyId = company.id
      const long = new Date(now.getTime() - LONG_DAYS * DAY_MS)
      const recent = new Date(now.getTime() - RECENT_DAYS * DAY_MS)
      const ofCompany = {
        OR: [
          { companyId },
          { person: { companyId } },
          { opportunity: { companyId } },
        ],
      }

      const [email, meeting, note, call, zap, deals, overdueTasks, sdAccess] =
        await Promise.all([
          prisma.crmEmailMessage.aggregate({
            _max: { sentAt: true },
            where: {
              workspaceId,
              OR: [{ person: { companyId } }, { opportunity: { companyId } }],
            },
          }),
          prisma.crmCalendarEvent.aggregate({
            _max: { startsAt: true },
            where: {
              workspaceId,
              startsAt: { lte: now },
              OR: [{ person: { companyId } }, { opportunity: { companyId } }],
            },
          }),
          prisma.crmNote.aggregate({
            _max: { createdAt: true },
            where: { workspaceId, deletedAt: null, ...ofCompany },
          }),
          prisma.whatsAppPhoneCall.aggregate({
            _max: { createdAt: true },
            where: { workspaceId, crmPerson: { companyId } },
          }),
          zapStats(workspaceId, Prisma.sql`p.company_id = ${companyId}`, now),
          prisma.crmOpportunity.findMany({
            where: { workspaceId, companyId, deletedAt: null },
            select: {
              id: true,
              updatedAt: true,
              wonAt: true,
              stage: { select: { category: true } },
              health: { select: { level: true } },
            },
          }),
          prisma.crmTask.count({
            where: {
              workspaceId,
              deletedAt: null,
              status: { not: 'DONE' },
              dueDate: { lt: now },
              ...ofCompany,
            },
          }),
          prisma.workspaceModuleAccess.findFirst({
            where: { workspaceId, module: 'SERVICE_DESK', enabled: true },
            select: { workspaceId: true },
          }),
        ])

      let openDeals = 0
      let highRiskDeals = 0
      let mediumRiskDeals = 0
      let lostDeals180d = 0
      let wonDeals180d = 0
      for (const deal of deals) {
        const category = deal.stage.category
        if (category === 'OPEN') {
          openDeals++
          if (deal.health?.level === 'HIGH') highRiskDeals++
          if (deal.health?.level === 'MEDIUM') mediumRiskDeals++
        } else if (category === 'LOST' && deal.updatedAt >= long) {
          lostDeals180d++
        } else if (
          category === 'WON' &&
          (deal.wonAt ?? deal.updatedAt) >= long
        ) {
          wonDeals180d++
        }
      }

      const sd = sdAccess
        ? await serviceDeskSignals(workspaceId, company, recent, long)
        : ok(null)
      if (!sd.ok) return sd

      return ok({
        now,
        companyCreatedAt: company.createdAt,
        crm: {
          lastInteractionAt: maxDate(
            email._max.sentAt,
            meeting._max.startsAt,
            note._max.createdAt,
            call._max.createdAt,
            zap.last_message_at,
          ),
          openDeals,
          highRiskDeals,
          mediumRiskDeals,
          totalDeals: deals.length,
          lostDeals180d,
          wonDeals180d,
          overdueTasks,
        },
        zap:
          zap.recent > 0
            ? {
                conversations: zap.recent,
                avgSentiment: zap.scored > 0 ? zap.avg_sentiment : null,
                negativeConversations: zap.negative,
              }
            : null,
        sd: sd.value,
      })
    } catch (error) {
      return err(
        dbError('Failed to collect the customer health signals', error),
      )
    }
  },

  /** Signals of an open deal (C4). */
  async opportunitySignals(
    workspaceId: string,
    deal: {
      id: string
      closeDate: Date | null
      pointOfContactId: string | null
      createdAt: Date
      updatedAt: Date
      stageChangedAt: Date | null
      contactChangedAt: Date | null
    },
    now: Date,
  ): Promise<Result<OpportunityHealthSignals>> {
    try {
      const opportunityId = deal.id
      const [email, meeting, nextMeeting, note, task, call, openTasks, zap] =
        await Promise.all([
          prisma.crmEmailMessage.aggregate({
            _max: { sentAt: true },
            where: { workspaceId, opportunityId },
          }),
          prisma.crmCalendarEvent.aggregate({
            _max: { startsAt: true },
            where: { workspaceId, opportunityId, startsAt: { lte: now } },
          }),
          prisma.crmCalendarEvent.count({
            where: { workspaceId, opportunityId, startsAt: { gt: now } },
          }),
          prisma.crmNote.aggregate({
            _max: { createdAt: true },
            where: { workspaceId, opportunityId, deletedAt: null },
          }),
          prisma.crmTask.aggregate({
            _max: { updatedAt: true },
            where: { workspaceId, opportunityId, deletedAt: null },
          }),
          prisma.whatsAppPhoneCall.aggregate({
            _max: { createdAt: true },
            where: { workspaceId, crmOpportunityId: opportunityId },
          }),
          prisma.crmTask.findMany({
            where: {
              workspaceId,
              opportunityId,
              deletedAt: null,
              status: { not: 'DONE' },
            },
            select: { dueDate: true },
          }),
          deal.pointOfContactId
            ? zapStats(
                workspaceId,
                Prisma.sql`p.id = ${deal.pointOfContactId}`,
                now,
              )
            : Promise.resolve(null),
        ])

      const overdueTasks = openTasks.filter(
        (t) => t.dueDate !== null && t.dueDate < now,
      ).length
      const hasOpenTask = openTasks.some(
        (t) => t.dueDate === null || t.dueDate >= now,
      )

      const lastInteractionAt = maxDate(
        email._max.sentAt,
        meeting._max.startsAt,
        call._max.createdAt,
        zap?.last_message_at,
      )
      return ok({
        now,
        createdAt: deal.createdAt,
        stageChangedAt: deal.stageChangedAt,
        lastActivityAt: maxDate(
          deal.updatedAt,
          note._max.createdAt,
          task._max.updatedAt,
          lastInteractionAt,
        ),
        lastInteractionAt,
        closeDate: deal.closeDate,
        pointOfContactId: deal.pointOfContactId,
        contactChangedAt: deal.contactChangedAt,
        overdueTasks,
        hasNextStep: hasOpenTask || nextMeeting > 0,
      })
    } catch (error) {
      return err(dbError('Failed to collect the deal health signals', error))
    }
  },
}
