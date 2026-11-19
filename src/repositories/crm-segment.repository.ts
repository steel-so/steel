import type { CrmSegment } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { crmSegmentNameTaken } from '@/src/errors'
import type { CampaignCandidate } from '@/src/lib/crm-campaign/audience'
import { customFieldValueWhere } from '@/src/lib/crm-newsletter/segment-where'
import {
  daysAgo,
  EMPTY_RESOLVED_SET,
  OPT_OUT_KEY,
  type ResolvedSet,
  type SegmentContext,
  segmentNeeds,
  segmentWhere,
} from '@/src/lib/crm-segment/compile'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import type {
  CrmSegmentCondition,
  CrmSegmentContactDTO,
  CrmSegmentDefinition,
  CrmSegmentOptionsDTO,
  CrmSegmentTarget,
} from '@/src/schemas/crm-segment.schema'
import { dbError } from './db-error'

/**
 * Persistence and resolution of dynamic contact segments. Rules Prisma
 * cannot express as a nested filter are resolved here into id/e-mail sets
 * (`resolveContext`) and then compiled by `src/lib/crm-segment/compile.ts`.
 */

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002'

type AnyWhere = Record<string, unknown>

function emptySet(): ResolvedSet {
  return { ...EMPTY_RESOLVED_SET }
}

function unique(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))]
}

function lower(emails: string[]): string[] {
  return emails.map((e) => e.trim().toLowerCase()).filter(Boolean)
}

async function resolveOne(
  workspaceId: string,
  target: CrmSegmentTarget,
  need: { key: string; condition: CrmSegmentCondition },
  now: Date,
): Promise<ResolvedSet> {
  const { condition, key } = need
  const set = emptySet()

  if (key === OPT_OUT_KEY) {
    const rows = await prisma.crmEmailOptOut.findMany({
      where: { workspaceId },
      select: { email: true, personId: true },
    })
    set.emails = unique(lower(rows.map((r) => r.email)))
    set.personIds = unique(rows.map((r) => r.personId))
    return set
  }

  switch (condition.type) {
    case 'customField': {
      const rows = await prisma.crmCustomFieldValue.findMany({
        where: {
          AND: [
            {
              definitionId: condition.definitionId,
              definition: {
                workspaceId,
                entity: target === 'COMPANY' ? 'COMPANY' : 'PERSON',
                deletedAt: null,
              },
            },
            customFieldValueWhere({
              ...condition,
              op: condition.op === 'isNotSet' ? 'isSet' : condition.op,
            }),
          ],
        },
        select: { recordId: true },
      })
      const ids = rows.map((r) => r.recordId)
      if (target === 'COMPANY') set.companyIds = ids
      else set.personIds = ids
      return set
    }
    case 'activity': {
      const since = daysAgo(now, condition.days)
      if (target === 'COMPANY') {
        const rows = await prisma.crmActivity.findMany({
          where: {
            workspaceId,
            createdAt: { gte: since },
            companyId: { not: null },
          },
          distinct: ['companyId'],
          select: { companyId: true },
        })
        set.companyIds = unique(rows.map((r) => r.companyId))
      } else {
        const rows = await prisma.crmActivity.findMany({
          where: {
            workspaceId,
            createdAt: { gte: since },
            personId: { not: null },
          },
          distinct: ['personId'],
          select: { personId: true },
        })
        set.personIds = unique(rows.map((r) => r.personId))
      }
      return set
    }
    case 'emailEngagement': {
      const since = daysAgo(now, condition.days)
      const dateFilter =
        condition.event === 'received'
          ? { emailSentAt: { gte: since } }
          : condition.event === 'opened'
            ? { emailOpenedAt: { gte: since } }
            : { emailClickedAt: { gte: since } }
      const rows = await prisma.crmCampaignRecipient.findMany({
        where: { workspaceId, ...dateFilter },
        select: { personId: true, leadId: true },
      })
      set.personIds = unique(rows.map((r) => r.personId))
      set.leadIds = unique(rows.map((r) => r.leadId))
      return set
    }
    case 'campaign': {
      const [recipients, conversions] = await Promise.all([
        prisma.crmCampaignRecipient.findMany({
          where: {
            workspaceId,
            campaignId: { in: condition.campaignIds },
          },
          select: { personId: true, leadId: true },
        }),
        prisma.crmCampaignConversion.findMany({
          where: {
            campaignId: { in: condition.campaignIds },
            campaign: { workspaceId },
          },
          select: { personId: true, leadId: true },
        }),
      ])
      set.personIds = unique([
        ...recipients.map((r) => r.personId),
        ...conversions.map((r) => r.personId),
      ])
      set.leadIds = unique([
        ...recipients.map((r) => r.leadId),
        ...conversions.map((r) => r.leadId),
      ])
      return set
    }
    case 'mailingList': {
      const rows = await prisma.crmMailingListMember.findMany({
        where: {
          mailingListId: { in: condition.listIds },
          mailingList: { workspaceId, deletedAt: null },
        },
        select: { email: true, personId: true },
      })
      set.personIds = unique(rows.map((r) => r.personId))
      set.emails = unique(lower(rows.map((r) => r.email)))
      return set
    }
    default:
      return set
  }
}

/** Builds the compile context: every set the rules need, resolved. */
async function resolveContext(
  workspaceId: string,
  target: CrmSegmentTarget,
  def: CrmSegmentDefinition,
): Promise<SegmentContext> {
  const now = new Date()
  const needs = segmentNeeds(def)
  const sets: Record<string, ResolvedSet> = {}
  await Promise.all(
    needs.map(async (need) => {
      sets[need.key] = await resolveOne(workspaceId, target, need, now)
    }),
  )
  return { sets, now }
}

async function compileWhere(
  workspaceId: string,
  target: CrmSegmentTarget,
  def: CrmSegmentDefinition,
): Promise<AnyWhere> {
  const ctx = await resolveContext(workspaceId, target, def)
  return segmentWhere(workspaceId, target, def, ctx)
}

type ContactRow = {
  id: string
  name: string
  emails: string[]
  phones: string[]
  convertedPersonId?: string | null
}

function toContact(row: ContactRow): CrmSegmentContactDTO {
  return {
    id: row.id,
    name: row.name,
    email: row.emails[0] ?? null,
    phone: row.phones[0] ?? null,
  }
}

const CONTACT_SELECT = {
  id: true,
  name: true,
  emails: true,
  phones: true,
} as const

async function countAndRows(
  target: CrmSegmentTarget,
  where: AnyWhere,
  skip: number,
  take: number,
): Promise<{ total: number; rows: ContactRow[] }> {
  const order = [{ createdAt: 'desc' as const }, { id: 'asc' as const }]
  if (target === 'PERSON') {
    const w = where as unknown as Prisma.CrmPersonWhereInput
    const [total, rows] = await Promise.all([
      prisma.crmPerson.count({ where: w }),
      prisma.crmPerson.findMany({
        where: w,
        orderBy: order,
        skip,
        take,
        select: CONTACT_SELECT,
      }),
    ])
    return { total, rows }
  }
  if (target === 'LEAD') {
    const w = where as unknown as Prisma.CrmLeadWhereInput
    const [total, rows] = await Promise.all([
      prisma.crmLead.count({ where: w }),
      prisma.crmLead.findMany({
        where: w,
        orderBy: order,
        skip,
        take,
        select: CONTACT_SELECT,
      }),
    ])
    return { total, rows }
  }
  const w = where as unknown as Prisma.CrmCompanyWhereInput
  const [total, rows] = await Promise.all([
    prisma.crmCompany.count({ where: w }),
    prisma.crmCompany.findMany({
      where: w,
      orderBy: order,
      skip,
      take,
      select: CONTACT_SELECT,
    }),
  ])
  return { total, rows }
}

export const CrmSegmentRepository = {
  async list(workspaceId: string): Promise<Result<CrmSegment[]>> {
    try {
      return ok(
        await prisma.crmSegment.findMany({
          where: { workspaceId },
          orderBy: { name: 'asc' },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list CRM segments', error))
    }
  },

  async count(workspaceId: string): Promise<Result<number>> {
    try {
      return ok(await prisma.crmSegment.count({ where: { workspaceId } }))
    } catch (error) {
      return err(dbError('Failed to count CRM segments', error))
    }
  },

  async findById(
    workspaceId: string,
    segmentId: string,
  ): Promise<Result<CrmSegment | null>> {
    try {
      return ok(
        await prisma.crmSegment.findFirst({
          where: { id: segmentId, workspaceId },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find CRM segment', error))
    }
  },

  async findManyByIds(
    workspaceId: string,
    ids: string[],
  ): Promise<Result<CrmSegment[]>> {
    if (ids.length === 0) return ok([])
    try {
      return ok(
        await prisma.crmSegment.findMany({
          where: { workspaceId, id: { in: ids } },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find CRM segments', error))
    }
  },

  async create(data: {
    workspaceId: string
    name: string
    description: string | null
    target: CrmSegmentTarget
    definition: Prisma.InputJsonValue
    createdById: string
  }): Promise<Result<CrmSegment>> {
    try {
      return ok(await prisma.crmSegment.create({ data }))
    } catch (error) {
      if (isUniqueViolation(error)) return err(crmSegmentNameTaken())
      return err(dbError('Failed to create CRM segment', error))
    }
  },

  async update(
    segmentId: string,
    data: {
      name?: string
      description?: string | null
      target?: CrmSegmentTarget
      definition?: Prisma.InputJsonValue
      updatedById: string
    },
  ): Promise<Result<CrmSegment>> {
    try {
      return ok(
        await prisma.crmSegment.update({ where: { id: segmentId }, data }),
      )
    } catch (error) {
      if (isUniqueViolation(error)) return err(crmSegmentNameTaken())
      return err(dbError('Failed to update CRM segment', error))
    }
  },

  async delete(segmentId: string): Promise<Result<void>> {
    try {
      await prisma.crmSegment.delete({ where: { id: segmentId } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete CRM segment', error))
    }
  },

  /** Count and a page of the contacts matching the rules right now. */
  async contacts(
    workspaceId: string,
    target: CrmSegmentTarget,
    def: CrmSegmentDefinition,
    skip: number,
    take: number,
  ): Promise<Result<{ total: number; items: CrmSegmentContactDTO[] }>> {
    try {
      const where = await compileWhere(workspaceId, target, def)
      const { total, rows } = await countAndRows(target, where, skip, take)
      return ok({ total, items: rows.map(toContact) })
    } catch (error) {
      return err(dbError('Failed to resolve CRM segment contacts', error))
    }
  },

  /**
   * Every contact of the segment as campaign candidates (the opt-outs and
   * dedupe are applied by the audience builder). Capped for safety.
   */
  async candidates(
    workspaceId: string,
    target: CrmSegmentTarget,
    def: CrmSegmentDefinition,
    limit = 100000,
  ): Promise<Result<CampaignCandidate[]>> {
    try {
      const where = await compileWhere(workspaceId, target, def)
      if (target === 'PERSON') {
        const rows = await prisma.crmPerson.findMany({
          where: where as unknown as Prisma.CrmPersonWhereInput,
          select: CONTACT_SELECT,
          orderBy: { createdAt: 'asc' },
          take: limit,
        })
        return ok(
          rows.map((row) => ({
            personId: row.id,
            name: row.name,
            email: row.emails[0] ?? null,
            phone: row.phones[0] ?? null,
          })),
        )
      }
      if (target === 'LEAD') {
        const rows = await prisma.crmLead.findMany({
          where: where as unknown as Prisma.CrmLeadWhereInput,
          select: { ...CONTACT_SELECT, convertedPersonId: true },
          orderBy: { createdAt: 'asc' },
          take: limit,
        })
        return ok(
          rows.map((row) => ({
            personId: row.convertedPersonId,
            leadId: row.id,
            name: row.name,
            email: row.emails[0] ?? null,
            phone: row.phones[0] ?? null,
          })),
        )
      }
      const rows = await prisma.crmCompany.findMany({
        where: where as unknown as Prisma.CrmCompanyWhereInput,
        select: CONTACT_SELECT,
        orderBy: { createdAt: 'asc' },
        take: limit,
      })
      return ok(
        rows.map((row) => ({
          name: row.name,
          email: row.emails[0] ?? null,
          phone: row.phones[0] ?? null,
        })),
      )
    } catch (error) {
      return err(dbError('Failed to collect CRM segment candidates', error))
    }
  },

  /** Lookups the rule builder offers. */
  async options(workspaceId: string): Promise<Result<CrmSegmentOptionsDTO>> {
    try {
      const [campaigns, mailingLists, customFields] = await Promise.all([
        prisma.crmCampaign.findMany({
          where: { workspaceId, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 200,
          select: { id: true, name: true },
        }),
        prisma.crmMailingList.findMany({
          where: { workspaceId, deletedAt: null },
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        }),
        prisma.crmCustomFieldDefinition.findMany({
          where: {
            workspaceId,
            deletedAt: null,
            entity: { in: ['PERSON', 'COMPANY'] },
          },
          orderBy: [{ position: 'asc' }, { label: 'asc' }],
          select: {
            id: true,
            label: true,
            entity: true,
            type: true,
            options: true,
          },
        }),
      ])
      return ok({
        campaigns,
        mailingLists,
        customFields: customFields.map((f) => ({
          id: f.id,
          label: f.label,
          entity:
            f.entity === 'COMPANY' ? ('COMPANY' as const) : ('PERSON' as const),
          type: f.type,
          options: f.options,
        })),
      })
    } catch (error) {
      return err(dbError('Failed to load CRM segment options', error))
    }
  },
}
