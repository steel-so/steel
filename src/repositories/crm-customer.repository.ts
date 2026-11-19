import { Prisma } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import type {
  CrmCustomerFilters,
  CrmCustomerSort,
} from '@/src/schemas/crm-customer.schema'
import { dbError } from './db-error'

/**
 * Clientes view: companies and people with at least one WON opportunity,
 * aggregated in SQL (one pass over the won deals) so the filters, the
 * sorting and the pagination happen on the server. Nothing is stored.
 *
 * - Won date of a deal = `won_at`, else `close_date`, else `updated_at`.
 * - A deal counts for its company and for its point-of-contact person.
 * - Owner = the company's account owner, else the owner of the latest won
 *   deal (people use the latest won deal's owner).
 * - Next renewal = earliest ACTIVE contract end still ahead (a person uses
 *   the contract of their company).
 */

export type CustomerRow = {
  kind: 'COMPANY' | 'PERSON'
  entity_id: string
  name: string
  subtitle: string | null
  deals: number
  total: number | null
  average: number | null
  first_won: Date | null
  last_won: Date | null
  next_renewal: Date | null
  owner_id: string | null
  owner_name: string | null
  health_level: 'LOW' | 'MEDIUM' | 'HIGH' | null
  health_risk: number | null
}

export type CustomerTotals = {
  customers: number
  revenue: number
  deals: number
}

/** Order by column of each sort key (whitelist: never user text). */
const SORT_COLUMN: Record<CrmCustomerSort, string> = {
  name: 'LOWER(b.name)',
  deals: 'b.deals',
  total: 'b.total',
  average: 'b.average',
  firstWonAt: 'b.first_won',
  lastWonAt: 'b.last_won',
  nextRenewalAt: 'b.next_renewal',
}

const SAO_PAULO = '-03:00'

function dayStart(day: string): Date {
  return new Date(`${day}T00:00:00${SAO_PAULO}`)
}

function dayAfter(day: string): Date {
  return new Date(dayStart(day).getTime() + 24 * 60 * 60 * 1000)
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

/** `WITH won, agg, base` — the aggregation shared by every query. */
function withClause(
  workspaceId: string,
  filters: CrmCustomerFilters,
): Prisma.Sql {
  const wonScope: Prisma.Sql[] = [
    Prisma.sql`o.workspace_id = ${workspaceId}`,
    Prisma.sql`o.deleted_at IS NULL`,
    Prisma.sql`s.category = 'WON'`,
  ]
  if (filters.pipelineId) {
    wonScope.push(Prisma.sql`o.pipeline_id = ${filters.pipelineId}`)
  }
  if (filters.productId) {
    wonScope.push(
      Prisma.sql`EXISTS (SELECT 1 FROM crm_opportunity_line_items li WHERE li.opportunity_id = o.id AND li.product_id = ${filters.productId})`,
    )
  }
  const period = periodSql(filters)

  return Prisma.sql`
    WITH won AS (
      SELECT o.id, o.company_id, o.point_of_contact_id, o.owner_id,
             COALESCE(o.amount, 0) AS amount,
             COALESCE(o.won_at, o.close_date, o.updated_at) AS won_date
      FROM crm_opportunities o
      JOIN crm_pipeline_stages s ON s.id = o.stage_id
      WHERE ${Prisma.join(wonScope, ' AND ')}
    ),
    agg AS (
      SELECT 'COMPANY'::text AS kind, w.company_id AS entity_id,
             COUNT(*)::int AS deals, SUM(w.amount)::float8 AS total,
             MIN(w.won_date) AS first_won, MAX(w.won_date) AS last_won,
             (ARRAY_AGG(w.owner_id ORDER BY w.won_date DESC)
               FILTER (WHERE w.owner_id IS NOT NULL))[1] AS last_owner
      FROM won w
      WHERE w.company_id IS NOT NULL AND ${period}
      GROUP BY w.company_id
      UNION ALL
      SELECT 'PERSON'::text AS kind, w.point_of_contact_id AS entity_id,
             COUNT(*)::int AS deals, SUM(w.amount)::float8 AS total,
             MIN(w.won_date) AS first_won, MAX(w.won_date) AS last_won,
             (ARRAY_AGG(w.owner_id ORDER BY w.won_date DESC)
               FILTER (WHERE w.owner_id IS NOT NULL))[1] AS last_owner
      FROM won w
      WHERE w.point_of_contact_id IS NOT NULL AND ${period}
      GROUP BY w.point_of_contact_id
    ),
    base AS (
      SELECT a.kind, a.entity_id, a.deals, a.total,
             (a.total / NULLIF(a.deals, 0))::float8 AS average,
             a.first_won, a.last_won,
             COALESCE(c.name, p.name) AS name,
             CASE WHEN a.kind = 'COMPANY' THEN c.domain ELSE pc.name END AS subtitle,
             CASE WHEN a.kind = 'COMPANY'
                  THEN COALESCE(c.account_owner_id, a.last_owner)
                  ELSE a.last_owner END AS owner_id,
             (SELECT MIN(k.end_date) FROM crm_contracts k
               WHERE k.workspace_id = ${workspaceId}
                 AND k.deleted_at IS NULL
                 AND k.status = 'ACTIVE'
                 AND k.end_date >= NOW()
                 AND k.company_id = CASE WHEN a.kind = 'COMPANY'
                                         THEN a.entity_id ELSE p.company_id END
             ) AS next_renewal,
             h.level::text AS health_level, h.risk_score AS health_risk
      FROM agg a
      LEFT JOIN crm_companies c
        ON a.kind = 'COMPANY' AND c.id = a.entity_id AND c.deleted_at IS NULL
      LEFT JOIN crm_people p
        ON a.kind = 'PERSON' AND p.id = a.entity_id AND p.deleted_at IS NULL
      LEFT JOIN crm_companies pc ON pc.id = p.company_id
      LEFT JOIN crm_customer_health h
        ON a.kind = 'COMPANY' AND h.company_id = a.entity_id
      WHERE c.id IS NOT NULL OR p.id IS NOT NULL
    )`
}

/** Filter on the won date of a deal (`w.won_date`). */
function periodSql(filters: CrmCustomerFilters): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`TRUE`]
  if (filters.wonFrom) {
    parts.push(Prisma.sql`w.won_date >= ${dayStart(filters.wonFrom)}`)
  }
  if (filters.wonTo) {
    parts.push(Prisma.sql`w.won_date < ${dayAfter(filters.wonTo)}`)
  }
  return Prisma.join(parts, ' AND ')
}

/** Filters over the aggregated customer (`base b`). */
function whereSql(filters: CrmCustomerFilters): Prisma.Sql {
  const conds: Prisma.Sql[] = [Prisma.sql`TRUE`]
  if (filters.kind !== 'ALL') conds.push(Prisma.sql`b.kind = ${filters.kind}`)
  if (filters.q) {
    conds.push(Prisma.sql`b.name ILIKE ${`%${escapeLike(filters.q)}%`}`)
  }
  if (filters.minTotal !== undefined) {
    conds.push(Prisma.sql`b.total >= ${filters.minTotal}`)
  }
  if (filters.maxTotal !== undefined) {
    conds.push(Prisma.sql`b.total <= ${filters.maxTotal}`)
  }
  if (filters.ownerId) conds.push(Prisma.sql`b.owner_id = ${filters.ownerId}`)
  if (filters.hasRenewal === 'yes') {
    conds.push(Prisma.sql`b.next_renewal IS NOT NULL`)
  }
  if (filters.hasRenewal === 'no') {
    conds.push(Prisma.sql`b.next_renewal IS NULL`)
  }
  if (filters.inactiveDays) {
    const cutoff = new Date(Date.now() - filters.inactiveDays * 86_400_000)
    conds.push(Prisma.sql`b.last_won < ${cutoff}`)
  }
  return Prisma.join(conds, ' AND ')
}

function orderSql(filters: CrmCustomerFilters): Prisma.Sql {
  const column = Prisma.raw(SORT_COLUMN[filters.sort])
  const direction = Prisma.raw(filters.dir === 'asc' ? 'ASC' : 'DESC')
  return Prisma.sql`ORDER BY ${column} ${direction} NULLS LAST, b.entity_id`
}

export const CrmCustomerRepository = {
  async list(
    workspaceId: string,
    filters: CrmCustomerFilters,
    skip: number,
    take: number,
  ): Promise<Result<CustomerRow[]>> {
    try {
      const rows = await prisma.$queryRaw<CustomerRow[]>(Prisma.sql`
        ${withClause(workspaceId, filters)}
        SELECT b.kind, b.entity_id, b.name, b.subtitle, b.deals, b.total,
               b.average, b.first_won, b.last_won, b.next_renewal, b.owner_id,
               u.name AS owner_name, b.health_level, b.health_risk
        FROM base b
        LEFT JOIN users u ON u.id = b.owner_id
        WHERE ${whereSql(filters)}
        ${orderSql(filters)}
        LIMIT ${take} OFFSET ${skip}`)
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list CRM customers', error))
    }
  },

  /**
   * Header totals of the filtered customers. Revenue and deals are counted
   * once per won deal, even when it counts for a company and a person.
   */
  async totals(
    workspaceId: string,
    filters: CrmCustomerFilters,
  ): Promise<Result<CustomerTotals>> {
    try {
      const rows = await prisma.$queryRaw<
        { customers: number; revenue: number | null; deals: number }[]
      >(Prisma.sql`
        ${withClause(workspaceId, filters)},
        f AS (SELECT b.kind, b.entity_id FROM base b WHERE ${whereSql(filters)}),
        matched AS (
          SELECT w.amount FROM won w
          WHERE ${periodSql(filters)}
            AND (
              EXISTS (SELECT 1 FROM f WHERE f.kind = 'COMPANY' AND f.entity_id = w.company_id)
              OR EXISTS (SELECT 1 FROM f WHERE f.kind = 'PERSON' AND f.entity_id = w.point_of_contact_id)
            )
        )
        SELECT (SELECT COUNT(*) FROM f)::int AS customers,
               COALESCE((SELECT SUM(amount) FROM matched), 0)::float8 AS revenue,
               (SELECT COUNT(*) FROM matched)::int AS deals`)
      const row = rows[0]
      return ok({
        customers: Number(row?.customers ?? 0),
        revenue: Number(row?.revenue ?? 0),
        deals: Number(row?.deals ?? 0),
      })
    } catch (error) {
      return err(dbError('Failed to total CRM customers', error))
    }
  },

  async count(
    workspaceId: string,
    filters: CrmCustomerFilters,
  ): Promise<Result<number>> {
    try {
      const rows = await prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
        ${withClause(workspaceId, filters)}
        SELECT COUNT(*)::int AS count FROM base b WHERE ${whereSql(filters)}`)
      return ok(Number(rows[0]?.count ?? 0))
    } catch (error) {
      return err(dbError('Failed to count CRM customers', error))
    }
  },

  /** Pipelines and products offered by the filters. */
  async filterOptions(workspaceId: string): Promise<
    Result<{
      pipelines: { id: string; name: string }[]
      products: { id: string; name: string }[]
    }>
  > {
    try {
      const [pipelines, products] = await Promise.all([
        prisma.crmPipeline.findMany({
          where: { workspaceId, deletedAt: null },
          orderBy: { position: 'asc' },
          select: { id: true, name: true },
        }),
        prisma.crmProduct.findMany({
          where: { workspaceId, deletedAt: null },
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        }),
      ])
      return ok({ pipelines, products })
    } catch (error) {
      return err(dbError('Failed to load CRM customer filter options', error))
    }
  },
}
