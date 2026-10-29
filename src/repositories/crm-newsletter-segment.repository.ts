import {
  type CrmCustomFieldDefinition,
  type CrmNewsletterIssue,
  type CrmNewsletterIssueStatus,
  type CrmNewsletterSegment,
  Prisma,
} from '@prisma/client'
import { crmNewsletterSegmentNameTaken } from '@/src/errors'
import {
  type CustomFieldCondition,
  customFieldValueWhere,
} from '@/src/lib/crm-newsletter/segment-where'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/**
 * Audience segments of newsletter issues (newsletter2, slice nl2-segments):
 * saved segments, the inputs the segment compiler cannot express as a
 * nested filter (recent issues, custom field matches), the audience
 * preview, and the subscriber ids of a segmented send.
 */

type SubscriberWhere = Prisma.CrmNewsletterSubscriberWhereInput

/** Same as `EDITABLE_ISSUE_STATUSES` (kept local: no import cycle). */
const EDITABLE: CrmNewsletterIssueStatus[] = ['DRAFT', 'SCHEDULED']
type Client = Prisma.TransactionClient | typeof prisma

export type AudienceSample = { id: string; email: string; name: string | null }

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002'

/**
 * Ids of the newsletter's ACTIVE subscribers matching `segmentWhere`. The
 * opt-out is applied afterwards in SQL (it has no relation to filter on).
 */
export async function segmentSubscriberIds(
  client: Client,
  workspaceId: string,
  newsletterId: string,
  segmentWhere: SubscriberWhere,
): Promise<string[]> {
  const rows = await client.crmNewsletterSubscriber.findMany({
    where: {
      AND: [{ newsletterId, workspaceId, status: 'ACTIVE' }, segmentWhere],
    },
    select: { id: true },
  })
  return rows.map((row) => row.id)
}

/**
 * SQL fragment restricting `s` (crm_newsletter_subscribers) to `ids`, or
 * nothing when there is no segment. One array parameter, whatever the size.
 */
export function segmentIdsSql(ids: string[] | null): Prisma.Sql {
  return ids ? Prisma.sql`AND s.id = ANY(${ids}::text[])` : Prisma.empty
}

export const CrmNewsletterSegmentRepository = {
  async list(
    workspaceId: string,
    newsletterId: string,
  ): Promise<Result<CrmNewsletterSegment[]>> {
    try {
      const rows = await prisma.crmNewsletterSegment.findMany({
        where: { workspaceId, newsletterId },
        orderBy: { name: 'asc' },
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list CRM newsletter segments', error))
    }
  },

  async count(newsletterId: string): Promise<Result<number>> {
    try {
      return ok(
        await prisma.crmNewsletterSegment.count({ where: { newsletterId } }),
      )
    } catch (error) {
      return err(dbError('Failed to count CRM newsletter segments', error))
    }
  },

  async findById(
    workspaceId: string,
    newsletterId: string,
    segmentId: string,
  ): Promise<Result<CrmNewsletterSegment | null>> {
    try {
      const row = await prisma.crmNewsletterSegment.findFirst({
        where: { id: segmentId, workspaceId, newsletterId },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find CRM newsletter segment', error))
    }
  },

  async create(data: {
    workspaceId: string
    newsletterId: string
    name: string
    definition: Prisma.InputJsonValue
    createdById: string
  }): Promise<Result<CrmNewsletterSegment>> {
    try {
      return ok(await prisma.crmNewsletterSegment.create({ data }))
    } catch (error) {
      if (isUniqueViolation(error)) return err(crmNewsletterSegmentNameTaken())
      return err(dbError('Failed to create CRM newsletter segment', error))
    }
  },

  async update(
    segmentId: string,
    data: {
      name?: string
      definition?: Prisma.InputJsonValue
      updatedById: string
    },
  ): Promise<Result<CrmNewsletterSegment>> {
    try {
      return ok(
        await prisma.crmNewsletterSegment.update({
          where: { id: segmentId },
          data,
        }),
      )
    } catch (error) {
      if (isUniqueViolation(error)) return err(crmNewsletterSegmentNameTaken())
      return err(dbError('Failed to update CRM newsletter segment', error))
    }
  },

  async delete(segmentId: string): Promise<Result<void>> {
    try {
      await prisma.crmNewsletterSegment.delete({ where: { id: segmentId } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete CRM newsletter segment', error))
    }
  },

  /** Ids of the last sent issues of the newsletter, newest first. */
  async recentSentIssueIds(
    newsletterId: string,
    limit: number,
  ): Promise<Result<string[]>> {
    if (limit <= 0) return ok([])
    try {
      const rows = await prisma.crmNewsletterIssue.findMany({
        where: { newsletterId, deletedAt: null, status: 'SENT' },
        orderBy: { sentAt: 'desc' },
        take: limit,
        select: { id: true },
      })
      return ok(rows.map((row) => row.id))
    } catch (error) {
      return err(dbError('Failed to list recent CRM newsletter issues', error))
    }
  },

  /** PERSON custom field definitions of the workspace, by id. */
  async personCustomFields(
    workspaceId: string,
    definitionIds?: string[],
  ): Promise<Result<CrmCustomFieldDefinition[]>> {
    try {
      const rows = await prisma.crmCustomFieldDefinition.findMany({
        where: {
          workspaceId,
          entity: 'PERSON',
          deletedAt: null,
          ...(definitionIds ? { id: { in: definitionIds } } : {}),
        },
        orderBy: [{ position: 'asc' }, { label: 'asc' }],
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list CRM person custom fields', error))
    }
  },

  /** People of the workspace whose custom field value matches `condition`. */
  async customFieldPersonIds(
    workspaceId: string,
    condition: CustomFieldCondition,
  ): Promise<Result<string[]>> {
    try {
      const rows = await prisma.crmCustomFieldValue.findMany({
        where: {
          AND: [
            {
              definitionId: condition.definitionId,
              definition: { workspaceId, entity: 'PERSON', deletedAt: null },
            },
            customFieldValueWhere(condition),
          ],
        },
        select: { recordId: true },
      })
      return ok(rows.map((row) => row.recordId))
    } catch (error) {
      return err(dbError('Failed to match CRM custom field values', error))
    }
  },

  /** Companies offered by the "Empresa" condition (search by name). */
  async companies(
    workspaceId: string,
    query: string | undefined,
    take: number,
    includeIds: string[] = [],
  ): Promise<Result<{ id: string; name: string }[]>> {
    try {
      const rows = await prisma.crmCompany.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          ...(query
            ? { name: { contains: query, mode: 'insensitive' as const } }
            : {}),
        },
        orderBy: { name: 'asc' },
        take,
        select: { id: true, name: true },
      })
      const missing = includeIds.filter(
        (id) => !rows.some((row) => row.id === id),
      )
      if (missing.length === 0) return ok(rows)
      const selected = await prisma.crmCompany.findMany({
        where: { workspaceId, id: { in: missing } },
        select: { id: true, name: true },
      })
      return ok([...selected, ...rows])
    } catch (error) {
      return err(dbError('Failed to list CRM companies for segments', error))
    }
  },

  /**
   * Audience of a segment right now: count and a sample (newest first), plus
   * the unsegmented total — ACTIVE subscribers outside the workspace-wide
   * opt-out, the same base the send snapshot uses.
   */
  async previewAudience(
    workspaceId: string,
    newsletterId: string,
    segmentWhere: SubscriberWhere | null,
    sampleSize: number,
  ): Promise<
    Result<{ count: number; total: number; sample: AudienceSample[] }>
  > {
    try {
      const ids = segmentWhere
        ? await segmentSubscriberIds(
            prisma,
            workspaceId,
            newsletterId,
            segmentWhere,
          )
        : null
      const base = Prisma.sql`
        FROM crm_newsletter_subscribers s
        WHERE s.newsletter_id = ${newsletterId}
          AND s.workspace_id = ${workspaceId}
          AND s.status = 'ACTIVE'
          AND NOT EXISTS (
            SELECT 1 FROM crm_email_opt_outs o
            WHERE o.workspace_id = s.workspace_id AND o.email = s.email
          )`
      const [total, count, sample] = await Promise.all([
        prisma.$queryRaw<
          { count: bigint }[]
        >`SELECT COUNT(*)::bigint AS count ${base}`,
        ids
          ? prisma.$queryRaw<
              { count: bigint }[]
            >`SELECT COUNT(*)::bigint AS count ${base} ${segmentIdsSql(ids)}`
          : null,
        prisma.$queryRaw<AudienceSample[]>`
          SELECT s.id, s.email, s.name ${base} ${segmentIdsSql(ids)}
          ORDER BY s.created_at DESC, s.id
          LIMIT ${sampleSize}`,
      ])
      const totalCount = Number(total[0].count)
      return ok({
        total: totalCount,
        count: count ? Number(count[0].count) : totalCount,
        sample,
      })
    } catch (error) {
      return err(dbError('Failed to preview CRM newsletter audience', error))
    }
  },

  /** Stores the issue's audience; `null` when it left DRAFT/SCHEDULED. */
  async setIssueSegment(
    issueId: string,
    segment: Prisma.InputJsonValue,
    updatedById: string,
  ): Promise<Result<CrmNewsletterIssue | null>> {
    try {
      const updated = await prisma.crmNewsletterIssue.updateMany({
        where: {
          id: issueId,
          deletedAt: null,
          status: { in: EDITABLE },
        },
        data: { segment, updatedById },
      })
      if (updated.count === 0) return ok(null)
      return ok(
        await prisma.crmNewsletterIssue.findUnique({ where: { id: issueId } }),
      )
    } catch (error) {
      return err(dbError('Failed to set CRM newsletter issue segment', error))
    }
  },
}
