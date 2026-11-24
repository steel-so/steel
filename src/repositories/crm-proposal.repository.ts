import { createId } from '@paralleldrive/cuid2'
import type {
  CrmProposal,
  CrmProposalSection,
  CrmProposalView,
  Prisma,
} from '@prisma/client'
import { crmProposalNotFound } from '@/src/errors'
import { CRM_PROPOSAL_EXPIRABLE_STATUSES } from '@/src/lib/crm-proposal-validity'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import type { CrmProposalSectionInputDTO } from '@/src/schemas/crm-proposal.schema'
import { dbError } from './db-error'

export type CrmProposalWithSections = CrmProposal & {
  sections: CrmProposalSection[]
}

/** Proposta vencida candidata a expirar, com o que o aviso por e-mail usa. */
export type CrmProposalExpirationCandidate = CrmProposal & {
  responsible: { id: string; name: string; email: string }
  workspace: { id: string; name: string; slug: string }
}

/** Agregados crus de leitura; o mapper compõe o DTO (completionRate etc.). */
export type CrmProposalMetricsRaw = {
  totalViews: number
  uniqueVisitors: number
  completed: number
  avgDurationMs: number
  views: CrmProposalView[]
}

function toSectionCreateInput(
  sections: CrmProposalSectionInputDTO[],
): Prisma.CrmProposalSectionCreateManyProposalInput[] {
  return sections.map((section) => ({
    type: section.type,
    order: section.order,
    enabled: section.enabled,
    content: section.content as unknown as Prisma.InputJsonValue,
  }))
}

export const CrmProposalRepository = {
  async listByWorkspace(
    workspaceId: string,
  ): Promise<Result<(CrmProposal & { _count: { views: number } })[]>> {
    try {
      const proposals = await prisma.crmProposal.findMany({
        where: { workspaceId, deletedAt: null },
        orderBy: { position: 'asc' },
        include: { _count: { select: { views: true } } },
      })
      return ok(proposals)
    } catch (error) {
      return err(dbError('Failed to list CRM proposals', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<CrmProposalWithSections>> {
    try {
      const proposal = await prisma.crmProposal.findFirst({
        where: { id, workspaceId, deletedAt: null },
        include: { sections: { orderBy: { order: 'asc' } } },
      })
      if (!proposal) return err(crmProposalNotFound())
      return ok(proposal)
    } catch (error) {
      return err(dbError('Failed to find CRM proposal by id', error))
    }
  },

  async findLatestByLeadId(
    leadId: string,
    workspaceId: string,
  ): Promise<Result<CrmProposalWithSections | null>> {
    try {
      const proposal = await prisma.crmProposal.findFirst({
        where: { leadId, workspaceId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        include: { sections: { orderBy: { order: 'asc' } } },
      })
      return ok(proposal)
    } catch (error) {
      return err(dbError('Failed to find CRM proposal by lead id', error))
    }
  },

  async findByShareToken(
    shareToken: string,
  ): Promise<Result<CrmProposalWithSections>> {
    try {
      const proposal = await prisma.crmProposal.findFirst({
        where: { shareToken, deletedAt: null, status: { not: 'DRAFT' } },
        include: { sections: { orderBy: { order: 'asc' } } },
      })
      if (!proposal) return err(crmProposalNotFound())
      return ok(proposal)
    } catch (error) {
      return err(dbError('Failed to find CRM proposal by share token', error))
    }
  },

  async create(data: {
    workspaceId: string
    createdById: string
    name: string
    templateId?: string
    companyId?: string
    contactId?: string
    opportunityId?: string
    leadId?: string
    responsibleId: string
    validUntil?: Date
    sections: CrmProposalSectionInputDTO[]
  }): Promise<Result<CrmProposalWithSections>> {
    try {
      const position = await prisma.crmProposal.count({
        where: { workspaceId: data.workspaceId, deletedAt: null },
      })
      const proposal = await prisma.crmProposal.create({
        data: {
          workspaceId: data.workspaceId,
          createdById: data.createdById,
          name: data.name,
          templateId: data.templateId,
          companyId: data.companyId,
          contactId: data.contactId,
          opportunityId: data.opportunityId,
          leadId: data.leadId,
          responsibleId: data.responsibleId,
          validUntil: data.validUntil,
          shareToken: createId(),
          position,
          sections: {
            createMany: { data: toSectionCreateInput(data.sections) },
          },
        },
        include: { sections: { orderBy: { order: 'asc' } } },
      })
      return ok(proposal)
    } catch (error) {
      return err(dbError('Failed to create CRM proposal', error))
    }
  },

  async update(
    id: string,
    data: {
      name?: string
      companyId?: string | null
      contactId?: string | null
      opportunityId?: string | null
      responsibleId?: string
      validUntil?: Date | null
      status?: CrmProposal['status']
      expiredAt?: Date | null
      updatedById?: string
      sections?: CrmProposalSectionInputDTO[]
    },
  ): Promise<Result<CrmProposalWithSections>> {
    try {
      const { sections, ...rest } = data
      const proposal = await prisma.$transaction(async (tx) => {
        if (sections) {
          await tx.crmProposalSection.deleteMany({ where: { proposalId: id } })
        }
        return tx.crmProposal.update({
          where: { id },
          data: {
            ...rest,
            ...(sections && {
              sections: {
                createMany: { data: toSectionCreateInput(sections) },
              },
            }),
          },
          include: { sections: { orderBy: { order: 'asc' } } },
        })
      })
      return ok(proposal)
    } catch (error) {
      return err(dbError('Failed to update CRM proposal', error))
    }
  },

  async setStatus(
    id: string,
    status: CrmProposal['status'],
    extra?: { sentAt?: Date },
  ): Promise<Result<CrmProposalWithSections>> {
    try {
      const proposal = await prisma.crmProposal.update({
        where: { id },
        data: { status, ...extra },
        include: { sections: { orderBy: { order: 'asc' } } },
      })
      return ok(proposal)
    } catch (error) {
      return err(dbError('Failed to update CRM proposal status', error))
    }
  },

  async softDelete(id: string): Promise<Result<void>> {
    try {
      await prisma.crmProposal.update({
        where: { id },
        data: { deletedAt: new Date() },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete CRM proposal', error))
    }
  },

  async reorder(
    workspaceId: string,
    orderedIds: string[],
  ): Promise<Result<void>> {
    try {
      await prisma.$transaction(
        orderedIds.map((id, position) =>
          prisma.crmProposal.update({
            where: { id, workspaceId },
            data: { position },
          }),
        ),
      )
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to reorder CRM proposals', error))
    }
  },

  /**
   * Propostas enviadas/vistas cuja data de validade já passou (`validUntil <
   * now`). O corte fino "vale até o fim do dia" fica no service.
   */
  async listExpirationCandidates(
    now: Date,
  ): Promise<Result<CrmProposalExpirationCandidate[]>> {
    try {
      const proposals = await prisma.crmProposal.findMany({
        where: {
          status: { in: [...CRM_PROPOSAL_EXPIRABLE_STATUSES] },
          validUntil: { lt: now },
          deletedAt: null,
        },
        orderBy: { validUntil: 'asc' },
        include: {
          responsible: { select: { id: true, name: true, email: true } },
          workspace: { select: { id: true, name: true, slug: true } },
        },
      })
      return ok(proposals)
    } catch (error) {
      return err(
        dbError('Failed to list CRM proposal expiration candidates', error),
      )
    }
  },

  /**
   * Marca como EXPIRED se ainda estiver enviada/vista. `false` = outra
   * operação (aceite, extensão, outro tick) chegou antes — não notificar.
   */
  async markExpired(id: string, at: Date): Promise<Result<boolean>> {
    try {
      const { count } = await prisma.crmProposal.updateMany({
        where: {
          id,
          status: { in: [...CRM_PROPOSAL_EXPIRABLE_STATUSES] },
          deletedAt: null,
        },
        data: { status: 'EXPIRED', expiredAt: at },
      })
      return ok(count === 1)
    } catch (error) {
      return err(dbError('Failed to expire CRM proposal', error))
    }
  },

  /**
   * Registra o aceite se a proposta ainda estiver enviada/vista. `false` =
   * o status mudou antes (aceite duplo, expiração, recusa).
   */
  async accept(
    id: string,
    data: { name: string; at: Date },
  ): Promise<Result<boolean>> {
    try {
      const { count } = await prisma.crmProposal.updateMany({
        where: {
          id,
          status: { in: [...CRM_PROPOSAL_EXPIRABLE_STATUSES] },
          deletedAt: null,
        },
        data: {
          status: 'ACCEPTED',
          acceptedAt: data.at,
          acceptedByName: data.name,
        },
      })
      return ok(count === 1)
    } catch (error) {
      return err(dbError('Failed to accept CRM proposal', error))
    }
  },
}

export const CrmProposalViewRepository = {
  async countByProposal(proposalId: string): Promise<Result<number>> {
    try {
      const count = await prisma.crmProposalView.count({
        where: { proposalId },
      })
      return ok(count)
    } catch (error) {
      return err(dbError('Failed to count CRM proposal views', error))
    }
  },

  async record(data: {
    proposalId: string
    viewId: string
    ipHash: string
    durationMs?: number
    reachedEnd?: boolean
    scrolledPct?: number
    referrer?: string
  }): Promise<Result<CrmProposalView>> {
    try {
      const view = await prisma.crmProposalView.upsert({
        where: {
          proposalId_viewId: {
            proposalId: data.proposalId,
            viewId: data.viewId,
          },
        },
        create: data,
        update: {
          durationMs: data.durationMs,
          reachedEnd: data.reachedEnd,
          scrolledPct: data.scrolledPct,
        },
      })
      return ok(view)
    } catch (error) {
      return err(dbError('Failed to record CRM proposal view', error))
    }
  },

  async listByProposal(proposalId: string): Promise<Result<CrmProposalView[]>> {
    try {
      const views = await prisma.crmProposalView.findMany({
        where: { proposalId },
        orderBy: { createdAt: 'desc' },
      })
      return ok(views)
    } catch (error) {
      return err(dbError('Failed to list CRM proposal views', error))
    }
  },

  /** Agregados de leitura + lista recente das visitas (cap de 200). */
  async metricsFor(proposalId: string): Promise<Result<CrmProposalMetricsRaw>> {
    try {
      const [agg, completed, uniques, views] = await Promise.all([
        prisma.crmProposalView.aggregate({
          where: { proposalId },
          _count: { _all: true },
          _avg: { durationMs: true },
        }),
        prisma.crmProposalView.count({
          where: { proposalId, reachedEnd: true },
        }),
        prisma.crmProposalView.groupBy({
          by: ['ipHash'],
          where: { proposalId },
        }),
        prisma.crmProposalView.findMany({
          where: { proposalId },
          orderBy: { createdAt: 'desc' },
          take: 200,
        }),
      ])
      return ok({
        totalViews: agg._count._all,
        uniqueVisitors: uniques.length,
        completed,
        avgDurationMs: Math.round(agg._avg.durationMs ?? 0),
        views,
      })
    } catch (error) {
      return err(dbError('Failed to compute CRM proposal metrics', error))
    }
  },
}
