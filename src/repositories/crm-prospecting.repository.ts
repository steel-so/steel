import type {
  CrmProspectChannel,
  CrmProspectDraft,
  CrmProspectDraftStatus,
  CrmProspectingSettings,
  CrmProspectUsage,
  Prisma,
} from '@prisma/client'
import { crmProspectDraftNotFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/**
 * Prospecting agent (T5): the workspace switches, the monthly counters and
 * the first-contact drafts. No business rules here; the service decides.
 */

export interface SettingsFields {
  enabled?: boolean
  monthlyWebLimit?: number
  monthlyDraftLimit?: number
  allowedChannels?: CrmProspectChannel[]
  valueProposition?: string | null
  signalKeywords?: string[]
}

export const CrmProspectingSettingsRepository = {
  async find(
    workspaceId: string,
  ): Promise<Result<CrmProspectingSettings | null>> {
    try {
      return ok(
        await prisma.crmProspectingSettings.findUnique({
          where: { workspaceId },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to load the prospecting settings', error))
    }
  },

  async upsert(
    workspaceId: string,
    fields: SettingsFields,
    updatedById: string,
  ): Promise<Result<CrmProspectingSettings>> {
    try {
      return ok(
        await prisma.crmProspectingSettings.upsert({
          where: { workspaceId },
          create: {
            workspaceId,
            allowedChannels: ['EMAIL', 'WHATSAPP'],
            ...fields,
            updatedById,
          },
          update: { ...fields, updatedById },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to save the prospecting settings', error))
    }
  },
}

export type UsageField = 'searches' | 'fetches' | 'drafts'

function firstCount(field: UsageField) {
  if (field === 'searches') return { searches: 1 }
  if (field === 'fetches') return { fetches: 1 }
  return { drafts: 1 }
}

function nextCount(field: UsageField) {
  const step = { increment: 1 }
  if (field === 'searches') return { searches: step }
  if (field === 'fetches') return { fetches: step }
  return { drafts: step }
}

export const CrmProspectUsageRepository = {
  async find(
    workspaceId: string,
    period: Date,
  ): Promise<Result<CrmProspectUsage | null>> {
    try {
      return ok(
        await prisma.crmProspectUsage.findUnique({
          where: { workspaceId_period: { workspaceId, period } },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to load the prospecting usage', error))
    }
  },

  async increment(
    workspaceId: string,
    period: Date,
    field: UsageField,
  ): Promise<Result<CrmProspectUsage>> {
    try {
      return ok(
        await prisma.crmProspectUsage.upsert({
          where: { workspaceId_period: { workspaceId, period } },
          create: { workspaceId, period, ...firstCount(field) },
          update: nextCount(field),
        }),
      )
    } catch (error) {
      return err(dbError('Failed to count the prospecting usage', error))
    }
  },
}

export interface DraftInsert {
  workspaceId: string
  leadId: string | null
  companyId: string | null
  personId: string | null
  targetName: string
  channel: CrmProspectChannel
  subject: string | null
  body: string
  toEmail: string | null
  toPhone: string | null
  summary: string | null
  signals: Prisma.InputJsonValue
  sources: Prisma.InputJsonValue
  agentId: string | null
  createdById: string
}

export interface DraftFilters {
  status?: CrmProspectDraftStatus
  leadId?: string
  companyId?: string
  limit: number
}

export const CrmProspectDraftRepository = {
  async list(
    workspaceId: string,
    filters: DraftFilters,
  ): Promise<Result<CrmProspectDraft[]>> {
    try {
      return ok(
        await prisma.crmProspectDraft.findMany({
          where: {
            workspaceId,
            ...(filters.status && { status: filters.status }),
            ...(filters.leadId && { leadId: filters.leadId }),
            ...(filters.companyId && { companyId: filters.companyId }),
          },
          orderBy: { createdAt: 'desc' },
          take: filters.limit,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list the prospect drafts', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<CrmProspectDraft>> {
    try {
      const row = await prisma.crmProspectDraft.findFirst({
        where: { id, workspaceId },
      })
      return row ? ok(row) : err(crmProspectDraftNotFound())
    } catch (error) {
      return err(dbError('Failed to load the prospect draft', error))
    }
  },

  /** A pending draft already covers this lead or company. */
  async findPendingFor(
    workspaceId: string,
    target: { leadId: string | null; companyId: string | null },
    channel: CrmProspectChannel,
  ): Promise<Result<CrmProspectDraft | null>> {
    const where: Prisma.CrmProspectDraftWhereInput[] = []
    if (target.leadId) where.push({ leadId: target.leadId })
    if (target.companyId && !target.leadId) {
      where.push({ companyId: target.companyId })
    }
    if (where.length === 0) return ok(null)
    try {
      return ok(
        await prisma.crmProspectDraft.findFirst({
          where: { workspaceId, status: 'PENDING', channel, OR: where },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to look for a pending draft', error))
    }
  },

  async create(data: DraftInsert): Promise<Result<CrmProspectDraft>> {
    try {
      return ok(await prisma.crmProspectDraft.create({ data }))
    } catch (error) {
      return err(dbError('Failed to create the prospect draft', error))
    }
  },

  /** Only a PENDING draft changes; `count: 0` means someone decided first. */
  async updatePending(
    id: string,
    workspaceId: string,
    data: Prisma.CrmProspectDraftUpdateManyMutationInput,
  ): Promise<Result<CrmProspectDraft | null>> {
    try {
      const { count } = await prisma.crmProspectDraft.updateMany({
        where: { id, workspaceId, status: 'PENDING' },
        data,
      })
      if (count === 0) return ok(null)
      return ok(
        await prisma.crmProspectDraft.findFirst({ where: { id, workspaceId } }),
      )
    } catch (error) {
      return err(dbError('Failed to update the prospect draft', error))
    }
  },

  /** APPROVED to SENT, once. */
  async markSent(
    id: string,
    workspaceId: string,
    decidedById: string,
  ): Promise<Result<CrmProspectDraft | null>> {
    try {
      const { count } = await prisma.crmProspectDraft.updateMany({
        where: { id, workspaceId, status: 'APPROVED' },
        data: { status: 'SENT', decidedById, decidedAt: new Date() },
      })
      if (count === 0) return ok(null)
      return ok(
        await prisma.crmProspectDraft.findFirst({ where: { id, workspaceId } }),
      )
    } catch (error) {
      return err(dbError('Failed to mark the prospect draft as sent', error))
    }
  },
}
