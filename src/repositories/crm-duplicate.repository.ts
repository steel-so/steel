import {
  type CrmDuplicateCandidate,
  type CrmDuplicateEntity,
  type CrmDuplicateStatus,
  type CrmMergeLog,
  Prisma,
} from '@prisma/client'
import {
  crmDuplicateInvalid,
  crmMergeNotFound,
  crmMergeUndoExpired,
} from '@/src/errors'
import type { AppError } from '@/src/errors/app-error'
import type {
  CompanyRecord,
  DuplicatePair,
  PersonRecord,
} from '@/src/lib/crm-duplicates/detect'
import type { FieldPlan } from '@/src/lib/crm-duplicates/merge-plan'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/** Rows read per workspace by one scan (bounds memory and CPU). */
export const SCAN_LIMIT = 30000

type MoveModel =
  | 'crmOpportunity'
  | 'crmLead'
  | 'crmLeadMeeting'
  | 'crmTask'
  | 'crmNote'
  | 'crmActivity'
  | 'crmEmailMessage'
  | 'crmCalendarEvent'
  | 'crmProposal'
  | 'whatsAppPhoneCall'
  | 'crmEmailCampaignRecipient'
  | 'crmCampaignRecipient'
  | 'crmCampaignConversion'
  | 'crmEmailOptOut'
  | 'crmMailingListMember'
  | 'crmNewsletterSubscriber'
  | 'crmPerson'
  | 'crmCompanyEnrichment'

export interface MoveSpec {
  model: MoveModel
  field: string
}

/** Every child row that points at a person and is re-pointed on a merge. */
export const PERSON_MOVES: MoveSpec[] = [
  { model: 'crmOpportunity', field: 'pointOfContactId' },
  { model: 'crmLead', field: 'convertedPersonId' },
  { model: 'crmLeadMeeting', field: 'contactPersonId' },
  { model: 'crmTask', field: 'personId' },
  { model: 'crmNote', field: 'personId' },
  { model: 'crmActivity', field: 'personId' },
  { model: 'crmEmailMessage', field: 'personId' },
  { model: 'crmCalendarEvent', field: 'personId' },
  { model: 'crmProposal', field: 'contactId' },
  { model: 'whatsAppPhoneCall', field: 'crmPersonId' },
  { model: 'crmEmailCampaignRecipient', field: 'personId' },
  { model: 'crmCampaignRecipient', field: 'personId' },
  { model: 'crmCampaignConversion', field: 'personId' },
  { model: 'crmEmailOptOut', field: 'personId' },
  { model: 'crmMailingListMember', field: 'personId' },
  { model: 'crmNewsletterSubscriber', field: 'personId' },
]

/** Same for a company (its enrichment is handled apart: 1:1). */
export const COMPANY_MOVES: MoveSpec[] = [
  { model: 'crmPerson', field: 'companyId' },
  { model: 'crmOpportunity', field: 'companyId' },
  { model: 'crmTask', field: 'companyId' },
  { model: 'crmNote', field: 'companyId' },
  { model: 'crmActivity', field: 'companyId' },
  { model: 'crmProposal', field: 'companyId' },
]

export interface MovedGroup {
  model: MoveModel
  field: string
  ids: string[]
}

export interface MergeSnapshot {
  version: 1
  /** Columns the archived record lost (company CNPJ/domain free the unique). */
  mergedBefore: Record<string, unknown>
  survivorBefore: Record<string, unknown>
  survivorAfter: Record<string, unknown>
  moved: MovedGroup[]
  customFieldValueIds: string[]
  names: { survivor: string; merged: string }
}

interface Delegate {
  findMany(args: {
    where: Record<string, unknown>
    select: { id: true }
  }): Promise<Array<{ id: string }>>
  updateMany(args: {
    where: Record<string, unknown>
    data: Record<string, unknown>
  }): Promise<{ count: number }>
}

const delegate = (tx: Prisma.TransactionClient, model: MoveModel): Delegate =>
  tx[model] as unknown as Delegate

/** Thrown inside a transaction to roll back with a domain error. */
class AbortWith extends Error {
  constructor(readonly appError: AppError) {
    super(appError.code)
  }
}

function columnData(patch: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    data[key] = key === 'address' && value === null ? Prisma.DbNull : value
  }
  return data
}

const sameValue = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as { code: string }).code === 'P2002'
  )
}

export const CrmDuplicateRepository = {
  async loadPeople(workspaceId: string): Promise<Result<PersonRecord[]>> {
    try {
      const rows = await prisma.crmPerson.findMany({
        where: { workspaceId, deletedAt: null },
        select: {
          id: true,
          name: true,
          emails: true,
          phones: true,
          companyId: true,
        },
        orderBy: { createdAt: 'asc' },
        take: SCAN_LIMIT,
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to load CRM people for duplicates', error))
    }
  },

  async loadCompanies(workspaceId: string): Promise<Result<CompanyRecord[]>> {
    try {
      const rows = await prisma.crmCompany.findMany({
        where: { workspaceId, deletedAt: null },
        select: { id: true, name: true, cnpj: true, domain: true },
        orderBy: { createdAt: 'asc' },
        take: SCAN_LIMIT,
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to load CRM companies for duplicates', error))
    }
  },

  /**
   * Arrival check: the record and the few rows that could match it (shared
   * e-mail/phone as typed, or a name sharing its first word), so a bulk
   * import never reloads the whole workspace per row.
   */
  async personNeighbourhood(
    workspaceId: string,
    id: string,
  ): Promise<Result<{ probe: PersonRecord; others: PersonRecord[] } | null>> {
    try {
      const select = {
        id: true,
        name: true,
        emails: true,
        phones: true,
        companyId: true,
      } as const
      const probe = await prisma.crmPerson.findFirst({
        where: { id, workspaceId, deletedAt: null },
        select,
      })
      if (!probe) return ok(null)
      const firstWord = probe.name.trim().split(/\s+/)[0] ?? ''
      const or: Prisma.CrmPersonWhereInput[] = []
      if (probe.emails.length > 0) {
        or.push({
          emails: { hasSome: probe.emails.map((e) => e.trim().toLowerCase()) },
        })
        or.push({ emails: { hasSome: probe.emails } })
      }
      if (probe.phones.length > 0)
        or.push({ phones: { hasSome: probe.phones } })
      if (firstWord.length >= 3)
        or.push({ name: { contains: firstWord, mode: 'insensitive' } })
      if (or.length === 0) return ok({ probe, others: [] })
      const others = await prisma.crmPerson.findMany({
        where: { workspaceId, deletedAt: null, id: { not: id }, OR: or },
        select,
        take: 400,
      })
      return ok({ probe, others })
    } catch (error) {
      return err(
        dbError('Failed to load the neighbourhood of a CRM person', error),
      )
    }
  },

  async companyNeighbourhood(
    workspaceId: string,
    id: string,
  ): Promise<Result<{ probe: CompanyRecord; others: CompanyRecord[] } | null>> {
    try {
      const select = { id: true, name: true, cnpj: true, domain: true } as const
      const probe = await prisma.crmCompany.findFirst({
        where: { id, workspaceId, deletedAt: null },
        select,
      })
      if (!probe) return ok(null)
      const firstWord = probe.name.trim().split(/\s+/)[0] ?? ''
      const or: Prisma.CrmCompanyWhereInput[] = []
      if (probe.cnpj)
        or.push({
          cnpj: { contains: probe.cnpj.replace(/\D/g, '').slice(0, 8) },
        })
      if (probe.domain)
        or.push({
          domain: {
            contains: probe.domain.replace(/^www\./i, ''),
            mode: 'insensitive',
          },
        })
      if (firstWord.length >= 3)
        or.push({ name: { contains: firstWord, mode: 'insensitive' } })
      if (or.length === 0) return ok({ probe, others: [] })
      const others = await prisma.crmCompany.findMany({
        where: { workspaceId, deletedAt: null, id: { not: id }, OR: or },
        select,
        take: 400,
      })
      return ok({ probe, others })
    } catch (error) {
      return err(
        dbError('Failed to load the neighbourhood of a CRM company', error),
      )
    }
  },

  /** Workspaces with the CRM module on (the periodic scan walks these). */
  async listCrmWorkspaceIds(): Promise<Result<string[]>> {
    try {
      const rows = await prisma.workspaceModuleAccess.findMany({
        where: { module: 'CRM', workspace: { status: 'ACTIVE' } },
        select: { workspaceId: true },
      })
      return ok(rows.map((row) => row.workspaceId))
    } catch (error) {
      return err(dbError('Failed to list CRM workspaces', error))
    }
  },

  /**
   * Stores the pairs of a scan. New pairs are created, PENDING ones are
   * refreshed, DISMISSED/MERGED ones stay as they are. With `prune`, PENDING
   * pairs the scan did not see again (merged, edited, deleted) are removed.
   */
  async saveScan(
    workspaceId: string,
    entity: CrmDuplicateEntity,
    pairs: DuplicatePair[],
    options: { prune: boolean },
  ): Promise<Result<{ created: DuplicatePair[]; pending: number }>> {
    try {
      const scanAt = new Date()
      const existing = await prisma.crmDuplicateCandidate.findMany({
        where: { workspaceId, entity },
        select: {
          id: true,
          leftId: true,
          rightId: true,
          status: true,
          score: true,
          reasons: true,
        },
      })
      const byKey = new Map(
        existing.map((row) => [`${row.leftId}|${row.rightId}`, row]),
      )

      const fresh: DuplicatePair[] = []
      const refresh: Array<{ id: string; pair: DuplicatePair }> = []
      const seen: string[] = []
      for (const pair of pairs) {
        const row = byKey.get(`${pair.leftId}|${pair.rightId}`)
        if (!row) fresh.push(pair)
        else if (row.status === 'PENDING') {
          seen.push(row.id)
          if (
            row.score !== pair.score ||
            row.reasons.join() !== pair.reasons.join()
          ) {
            refresh.push({ id: row.id, pair })
          }
        }
      }

      await prisma.$transaction(async (tx) => {
        if (fresh.length > 0) {
          await tx.crmDuplicateCandidate.createMany({
            data: fresh.map((pair) => ({
              workspaceId,
              entity,
              leftId: pair.leftId,
              rightId: pair.rightId,
              score: pair.score,
              reasons: pair.reasons,
              detectedAt: scanAt,
              lastSeenAt: scanAt,
            })),
            skipDuplicates: true,
          })
        }
        for (const item of refresh) {
          await tx.crmDuplicateCandidate.update({
            where: { id: item.id },
            data: { score: item.pair.score, reasons: item.pair.reasons },
          })
        }
        if (seen.length > 0) {
          await tx.crmDuplicateCandidate.updateMany({
            where: { id: { in: seen } },
            data: { lastSeenAt: scanAt },
          })
        }
        if (options.prune) {
          await tx.crmDuplicateCandidate.deleteMany({
            where: {
              workspaceId,
              entity,
              status: 'PENDING',
              lastSeenAt: { lt: scanAt },
              id: { notIn: seen },
            },
          })
        }
      })

      const pending = await prisma.crmDuplicateCandidate.count({
        where: { workspaceId, entity, status: 'PENDING' },
      })
      return ok({ created: fresh, pending })
    } catch (error) {
      return err(dbError('Failed to save duplicate candidates', error))
    }
  },

  async markNotified(
    workspaceId: string,
    entity: CrmDuplicateEntity,
  ): Promise<Result<number>> {
    try {
      const result = await prisma.crmDuplicateCandidate.updateMany({
        where: { workspaceId, entity, status: 'PENDING', notifiedAt: null },
        data: { notifiedAt: new Date() },
      })
      return ok(result.count)
    } catch (error) {
      return err(dbError('Failed to mark duplicates as notified', error))
    }
  },

  async list(
    workspaceId: string,
    filter: {
      entity: CrmDuplicateEntity
      status: CrmDuplicateStatus
      take: number
      skip: number
    },
  ): Promise<Result<{ rows: CrmDuplicateCandidate[]; total: number }>> {
    try {
      const where = {
        workspaceId,
        entity: filter.entity,
        status: filter.status,
      }
      const [rows, total] = await Promise.all([
        prisma.crmDuplicateCandidate.findMany({
          where,
          orderBy: [{ score: 'desc' }, { detectedAt: 'desc' }],
          take: filter.take,
          skip: filter.skip,
        }),
        prisma.crmDuplicateCandidate.count({ where }),
      ])
      return ok({ rows, total })
    } catch (error) {
      return err(dbError('Failed to list duplicate candidates', error))
    }
  },

  async pendingCounts(
    workspaceId: string,
  ): Promise<Result<{ person: number; company: number }>> {
    try {
      const rows = await prisma.crmDuplicateCandidate.groupBy({
        by: ['entity'],
        where: { workspaceId, status: 'PENDING' },
        _count: { _all: true },
      })
      const count = (entity: CrmDuplicateEntity) =>
        rows.find((row) => row.entity === entity)?._count._all ?? 0
      return ok({ person: count('PERSON'), company: count('COMPANY') })
    } catch (error) {
      return err(dbError('Failed to count duplicate candidates', error))
    }
  },

  async findCandidate(
    workspaceId: string,
    id: string,
  ): Promise<Result<CrmDuplicateCandidate | null>> {
    try {
      return ok(
        await prisma.crmDuplicateCandidate.findFirst({
          where: { id, workspaceId },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find duplicate candidate', error))
    }
  },

  async dismiss(
    id: string,
    resolvedById: string,
  ): Promise<Result<CrmDuplicateCandidate>> {
    try {
      return ok(
        await prisma.crmDuplicateCandidate.update({
          where: { id },
          data: { status: 'DISMISSED', resolvedAt: new Date(), resolvedById },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to dismiss duplicate candidate', error))
    }
  },

  /** Full rows of the records a page of candidates refers to. */
  async peopleByIds(workspaceId: string, ids: string[]) {
    try {
      return ok(
        await prisma.crmPerson.findMany({
          where: { workspaceId, id: { in: ids }, deletedAt: null },
          include: { company: { select: { id: true, name: true } } },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to load CRM people by ids', error))
    }
  },

  async companiesByIds(workspaceId: string, ids: string[]) {
    try {
      return ok(
        await prisma.crmCompany.findMany({
          where: { workspaceId, id: { in: ids }, deletedAt: null },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to load CRM companies by ids', error))
    }
  },

  /** How many child rows each record carries (shown in the compare view). */
  async footprint(
    entity: CrmDuplicateEntity,
    ids: string[],
  ): Promise<Result<Map<string, number>>> {
    try {
      const counts = new Map<string, number>(ids.map((id) => [id, 0]))
      const add = (id: string | null, n: number) => {
        if (id && counts.has(id)) counts.set(id, (counts.get(id) ?? 0) + n)
      }
      if (entity === 'PERSON') {
        const [notes, tasks, opps] = await Promise.all([
          prisma.crmNote.groupBy({
            by: ['personId'],
            where: { personId: { in: ids }, deletedAt: null },
            _count: { _all: true },
          }),
          prisma.crmTask.groupBy({
            by: ['personId'],
            where: { personId: { in: ids }, deletedAt: null },
            _count: { _all: true },
          }),
          prisma.crmOpportunity.groupBy({
            by: ['pointOfContactId'],
            where: { pointOfContactId: { in: ids }, deletedAt: null },
            _count: { _all: true },
          }),
        ])
        for (const row of notes) add(row.personId, row._count._all)
        for (const row of tasks) add(row.personId, row._count._all)
        for (const row of opps) add(row.pointOfContactId, row._count._all)
      } else {
        const [people, opps, notes] = await Promise.all([
          prisma.crmPerson.groupBy({
            by: ['companyId'],
            where: { companyId: { in: ids }, deletedAt: null },
            _count: { _all: true },
          }),
          prisma.crmOpportunity.groupBy({
            by: ['companyId'],
            where: { companyId: { in: ids }, deletedAt: null },
            _count: { _all: true },
          }),
          prisma.crmNote.groupBy({
            by: ['companyId'],
            where: { companyId: { in: ids }, deletedAt: null },
            _count: { _all: true },
          }),
        ])
        for (const row of people) add(row.companyId, row._count._all)
        for (const row of opps) add(row.companyId, row._count._all)
        for (const row of notes) add(row.companyId, row._count._all)
      }
      return ok(counts)
    } catch (error) {
      return err(
        dbError('Failed to count the history of duplicate records', error),
      )
    }
  },

  /** Active records of the pair, for the merge to plan against. */
  async loadPair(
    workspaceId: string,
    entity: CrmDuplicateEntity,
    survivorId: string,
    mergedId: string,
  ) {
    try {
      if (entity === 'PERSON') {
        const rows = await prisma.crmPerson.findMany({
          where: {
            workspaceId,
            deletedAt: null,
            id: { in: [survivorId, mergedId] },
          },
        })
        return ok({
          survivor: rows.find((row) => row.id === survivorId) ?? null,
          merged: rows.find((row) => row.id === mergedId) ?? null,
        })
      }
      const rows = await prisma.crmCompany.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          id: { in: [survivorId, mergedId] },
        },
      })
      return ok({
        survivor: rows.find((row) => row.id === survivorId) ?? null,
        merged: rows.find((row) => row.id === mergedId) ?? null,
      })
    } catch (error) {
      return err(dbError('Failed to load the records to merge', error))
    }
  },

  async executeMerge(input: {
    workspaceId: string
    entity: CrmDuplicateEntity
    survivorId: string
    mergedId: string
    candidateId: string | null
    performedById: string
    plan: FieldPlan
    undoUntil: Date
    summary: string
    names: { survivor: string; merged: string }
  }): Promise<Result<CrmMergeLog>> {
    const isCompany = input.entity === 'COMPANY'
    try {
      const log = await prisma.$transaction(
        async (tx) => {
          const now = new Date()
          const mergedBefore: Record<string, unknown> = {}

          if (isCompany) {
            const lost = await tx.crmCompany.findFirst({
              where: {
                id: input.mergedId,
                workspaceId: input.workspaceId,
                deletedAt: null,
              },
              select: { cnpj: true, domain: true },
            })
            if (!lost)
              throw new AbortWith(
                crmDuplicateInvalid('Um dos registros não existe mais'),
              )
            mergedBefore.cnpj = lost.cnpj
            mergedBefore.domain = lost.domain
            await tx.crmCompany.update({
              where: { id: input.mergedId },
              data: {
                deletedAt: now,
                cnpj: null,
                domain: null,
                updatedById: input.performedById,
              },
            })
          } else {
            const archived = await tx.crmPerson.updateMany({
              where: {
                id: input.mergedId,
                workspaceId: input.workspaceId,
                deletedAt: null,
              },
              data: { deletedAt: now, updatedById: input.performedById },
            })
            if (archived.count === 0) {
              throw new AbortWith(
                crmDuplicateInvalid('Um dos registros não existe mais'),
              )
            }
          }

          if (Object.keys(input.plan.after).length > 0) {
            const data = {
              ...columnData(input.plan.after),
              updatedById: input.performedById,
            }
            if (isCompany) {
              await tx.crmCompany.update({
                where: { id: input.survivorId },
                data,
              })
            } else {
              await tx.crmPerson.update({
                where: { id: input.survivorId },
                data,
              })
            }
          }

          const moved: MovedGroup[] = []
          for (const spec of isCompany ? COMPANY_MOVES : PERSON_MOVES) {
            const rows = await delegate(tx, spec.model).findMany({
              where: { [spec.field]: input.mergedId },
              select: { id: true },
            })
            if (rows.length === 0) continue
            const ids = rows.map((row) => row.id)
            await delegate(tx, spec.model).updateMany({
              where: { id: { in: ids } },
              data: { [spec.field]: input.survivorId },
            })
            moved.push({ model: spec.model, field: spec.field, ids })
          }

          if (isCompany) {
            const survivorEnrichment = await tx.crmCompanyEnrichment.findUnique(
              {
                where: { companyId: input.survivorId },
                select: { id: true },
              },
            )
            const lostEnrichment = survivorEnrichment
              ? null
              : await tx.crmCompanyEnrichment.findUnique({
                  where: { companyId: input.mergedId },
                  select: { id: true },
                })
            if (lostEnrichment) {
              await tx.crmCompanyEnrichment.update({
                where: { id: lostEnrichment.id },
                data: { companyId: input.survivorId },
              })
              moved.push({
                model: 'crmCompanyEnrichment',
                field: 'companyId',
                ids: [lostEnrichment.id],
              })
            }
          }

          const survivorValues = await tx.crmCustomFieldValue.findMany({
            where: { recordId: input.survivorId },
            select: { definitionId: true },
          })
          const taken = new Set(survivorValues.map((row) => row.definitionId))
          const lostValues = await tx.crmCustomFieldValue.findMany({
            where: { recordId: input.mergedId },
            select: { id: true, definitionId: true },
          })
          const customFieldValueIds = lostValues
            .filter((row) => !taken.has(row.definitionId))
            .map((row) => row.id)
          if (customFieldValueIds.length > 0) {
            await tx.crmCustomFieldValue.updateMany({
              where: { id: { in: customFieldValueIds } },
              data: { recordId: input.survivorId },
            })
          }

          const snapshot: MergeSnapshot = {
            version: 1,
            mergedBefore,
            survivorBefore: input.plan.before,
            survivorAfter: input.plan.after,
            moved,
            customFieldValueIds,
            names: input.names,
          }
          const created = await tx.crmMergeLog.create({
            data: {
              workspaceId: input.workspaceId,
              entity: input.entity,
              survivorId: input.survivorId,
              mergedId: input.mergedId,
              candidateId: input.candidateId,
              performedById: input.performedById,
              snapshot: snapshot as unknown as Prisma.InputJsonValue,
              undoUntil: input.undoUntil,
            },
          })

          await tx.crmDuplicateCandidate.updateMany({
            where: {
              workspaceId: input.workspaceId,
              entity: input.entity,
              OR: [{ leftId: input.mergedId }, { rightId: input.mergedId }],
              status: 'PENDING',
              ...(input.candidateId ? { NOT: { id: input.candidateId } } : {}),
            },
            data: {
              status: 'DISMISSED',
              resolvedAt: now,
              resolvedById: input.performedById,
            },
          })
          if (input.candidateId) {
            await tx.crmDuplicateCandidate.updateMany({
              where: { id: input.candidateId, workspaceId: input.workspaceId },
              data: {
                status: 'MERGED',
                resolvedAt: now,
                resolvedById: input.performedById,
              },
            })
          }

          await tx.crmActivity.create({
            data: {
              workspaceId: input.workspaceId,
              actorUserId: input.performedById,
              action: 'MERGED',
              entity: isCompany ? 'company' : 'person',
              entityId: input.survivorId,
              ...(isCompany
                ? { companyId: input.survivorId }
                : { personId: input.survivorId }),
              summary: input.summary,
            },
          })
          return created
        },
        { timeout: 60000 },
      )
      return ok(log)
    } catch (error) {
      if (error instanceof AbortWith) return err(error.appError)
      if (isUniqueViolation(error)) {
        return err(
          crmDuplicateInvalid(
            'Os registros têm dados únicos em conflito (CNPJ ou domínio)',
          ),
        )
      }
      return err(dbError('Failed to merge CRM records', error))
    }
  },

  async findMerge(
    workspaceId: string,
    id: string,
  ): Promise<Result<CrmMergeLog>> {
    try {
      const row = await prisma.crmMergeLog.findFirst({
        where: { id, workspaceId },
      })
      if (!row) return err(crmMergeNotFound())
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find CRM merge', error))
    }
  },

  async listMerges(
    workspaceId: string,
    entity: CrmDuplicateEntity,
    take: number,
  ): Promise<Result<CrmMergeLog[]>> {
    try {
      return ok(
        await prisma.crmMergeLog.findMany({
          where: { workspaceId, entity },
          orderBy: { createdAt: 'desc' },
          take,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list CRM merges', error))
    }
  },

  async undoMerge(input: {
    workspaceId: string
    mergeId: string
    undoneById: string
    summary: string
  }): Promise<Result<CrmMergeLog>> {
    try {
      const log = await prisma.$transaction(
        async (tx) => {
          const now = new Date()
          const row = await tx.crmMergeLog.findFirst({
            where: { id: input.mergeId, workspaceId: input.workspaceId },
          })
          if (!row) throw new AbortWith(crmMergeNotFound())
          if (row.undoneAt || row.undoUntil.getTime() < now.getTime()) {
            throw new AbortWith(crmMergeUndoExpired())
          }
          const snapshot = row.snapshot as unknown as MergeSnapshot
          const isCompany = row.entity === 'COMPANY'

          // 1. Survivor columns go back unless somebody edited them since.
          const current = isCompany
            ? await tx.crmCompany.findUnique({ where: { id: row.survivorId } })
            : await tx.crmPerson.findUnique({ where: { id: row.survivorId } })
          if (!current || current.deletedAt) {
            throw new AbortWith(
              crmDuplicateInvalid(
                'O registro mantido foi removido e a mesclagem não pode ser desfeita',
              ),
            )
          }
          const revert: Record<string, unknown> = {}
          for (const [key, value] of Object.entries(snapshot.survivorBefore)) {
            const live = (current as unknown as Record<string, unknown>)[key]
            const written = snapshot.survivorAfter[key]
            const liveComparable =
              live !== null &&
              typeof live === 'object' &&
              'toFixed' in (live as object)
                ? String(live)
                : live
            if (sameValue(liveComparable, written)) revert[key] = value
          }
          if (Object.keys(revert).length > 0) {
            const data = columnData(revert)
            if (isCompany)
              await tx.crmCompany.update({
                where: { id: row.survivorId },
                data,
              })
            else
              await tx.crmPerson.update({ where: { id: row.survivorId }, data })
          }

          // 2. The archived record comes back (company CNPJ/domain included).
          if (isCompany) {
            await tx.crmCompany.update({
              where: { id: row.mergedId },
              data: { deletedAt: null, ...columnData(snapshot.mergedBefore) },
            })
          } else {
            await tx.crmPerson.update({
              where: { id: row.mergedId },
              data: { deletedAt: null },
            })
          }

          // 3. Child rows return, unless they were moved again since.
          for (const group of snapshot.moved) {
            await delegate(tx, group.model).updateMany({
              where: { id: { in: group.ids }, [group.field]: row.survivorId },
              data: { [group.field]: row.mergedId },
            })
          }
          if (snapshot.customFieldValueIds.length > 0) {
            await tx.crmCustomFieldValue.updateMany({
              where: {
                id: { in: snapshot.customFieldValueIds },
                recordId: row.survivorId,
              },
              data: { recordId: row.mergedId },
            })
          }

          const updated = await tx.crmMergeLog.update({
            where: { id: row.id },
            data: { undoneAt: now, undoneById: input.undoneById },
          })
          if (row.candidateId) {
            await tx.crmDuplicateCandidate.updateMany({
              where: { id: row.candidateId, workspaceId: input.workspaceId },
              data: { status: 'PENDING', resolvedAt: null, resolvedById: null },
            })
          }
          await tx.crmActivity.create({
            data: {
              workspaceId: input.workspaceId,
              actorUserId: input.undoneById,
              action: 'MERGE_UNDONE',
              entity: isCompany ? 'company' : 'person',
              entityId: row.survivorId,
              ...(isCompany
                ? { companyId: row.survivorId }
                : { personId: row.survivorId }),
              summary: input.summary,
            },
          })
          return updated
        },
        { timeout: 60000 },
      )
      return ok(log)
    } catch (error) {
      if (error instanceof AbortWith) return err(error.appError)
      if (isUniqueViolation(error)) {
        return err(
          crmDuplicateInvalid(
            'Não foi possível desfazer: há dados únicos em conflito (CNPJ ou domínio)',
          ),
        )
      }
      return err(dbError('Failed to undo CRM merge', error))
    }
  },
}
