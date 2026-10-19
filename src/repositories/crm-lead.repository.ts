import type {
  CrmLead,
  CrmLeadContactAttempt,
  CrmLeadContactChannel,
  CrmLeadContactOutcome,
  CrmLeadMeeting,
  CrmLeadMeetingFormat,
  CrmLeadProposalFormat,
  CrmLeadProposalPresentation,
  CrmLeadQualification,
  CrmLeadReopening,
  CrmLeadStage,
} from '@prisma/client'
import { crmLeadReopenNotAllowed, notFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export const CrmLeadRepository = {
  async listByWorkspace(
    workspaceId: string,
    filters?: { stage?: CrmLeadStage },
  ): Promise<Result<CrmLead[]>> {
    try {
      const leads = await prisma.crmLead.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          ...(filters?.stage ? { stage: filters.stage } : {}),
        },
        orderBy: { position: 'asc' },
      })
      return ok(leads)
    } catch (error) {
      return err(dbError('Failed to list CRM leads', error))
    }
  },

  async findById(id: string, workspaceId: string): Promise<Result<CrmLead>> {
    try {
      const lead = await prisma.crmLead.findFirst({
        where: { id, workspaceId, deletedAt: null },
      })
      if (!lead) return err(notFound('CrmLead'))
      return ok(lead)
    } catch (error) {
      return err(dbError('Failed to find CRM lead by id', error))
    }
  },

  /**
   * Lead em aberto (não fechado, não excluído) mais antigo da workspace que
   * compartilha ao menos um e-mail (case-insensitive) ou telefone (só
   * dígitos). Base do dedupe de entrada de leads em todos os canais.
   * Espera `emails` em minúsculas e `phones` só com dígitos.
   */
  async findOpenByContacts(
    workspaceId: string,
    contacts: { emails: string[]; phones: string[] },
  ): Promise<Result<CrmLead | null>> {
    if (contacts.emails.length === 0 && contacts.phones.length === 0) {
      return ok(null)
    }
    try {
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM crm_leads
        WHERE workspace_id = ${workspaceId}
          AND deleted_at IS NULL
          AND stage <> 'CLOSED'
          AND (
            EXISTS (
              SELECT 1 FROM unnest(emails) e
              WHERE lower(trim(e)) = ANY(${contacts.emails}::text[])
            )
            OR EXISTS (
              SELECT 1 FROM unnest(phones) p
              WHERE regexp_replace(p, '[^0-9]', '', 'g') = ANY(${contacts.phones}::text[])
            )
          )
        ORDER BY created_at ASC
        LIMIT 1
      `
      if (rows.length === 0) return ok(null)
      const lead = await prisma.crmLead.findUnique({
        where: { id: rows[0].id },
      })
      return ok(lead)
    } catch (error) {
      return err(dbError('Failed to find open CRM lead by contacts', error))
    }
  },

  /**
   * Which of these external ids were already imported from `source`. Deleted
   * leads count on purpose (the unique key still holds them, and a lead the
   * team removed must not come back with the next import).
   */
  async findExistingExternalIds(
    workspaceId: string,
    source: string,
    externalIds: string[],
  ): Promise<Result<Set<string>>> {
    try {
      const rows = await prisma.crmLead.findMany({
        where: {
          workspaceId,
          externalSource: source,
          externalId: { in: externalIds },
        },
        select: { externalId: true },
      })
      return ok(
        new Set(rows.flatMap((r) => (r.externalId ? [r.externalId] : []))),
      )
    } catch (error) {
      return err(dbError('Failed to find imported CRM leads', error))
    }
  },

  /**
   * Appends phones to the lead imported from an external system, skipping
   * numbers it already has (compared by digits). No intake, no notifications.
   * `found=false` = no such lead; `added` = numbers actually appended.
   */
  async appendPhonesByExternalId(
    workspaceId: string,
    source: string,
    externalId: string,
    phones: string[],
  ): Promise<Result<{ found: boolean; added: number }>> {
    try {
      const lead = await prisma.crmLead.findFirst({
        where: { workspaceId, externalSource: source, externalId },
        select: { id: true, phones: true },
      })
      if (!lead) return ok({ found: false, added: 0 })
      const digits = (value: string) => value.replace(/\D/g, '')
      const known = new Set(lead.phones.map(digits))
      const fresh: string[] = []
      for (const phone of phones) {
        const key = digits(phone)
        if (!key || known.has(key)) continue
        known.add(key)
        fresh.push(phone)
      }
      if (fresh.length === 0) return ok({ found: true, added: 0 })
      await prisma.crmLead.update({
        where: { id: lead.id },
        data: { phones: { push: fresh } },
      })
      return ok({ found: true, added: fresh.length })
    } catch (error) {
      return err(dbError('Failed to append phones to CRM lead', error))
    }
  },

  async create(data: {
    workspaceId: string
    createdById: string
    name: string
    emails?: string[]
    phones?: string[]
    company?: string
    jobTitle?: string
    city?: string
    linkedin?: string
    source?: string
    channel?: string
    score: number
    ownerId?: string | null
    externalSource?: string
    externalId?: string
  }): Promise<Result<CrmLead>> {
    try {
      const position = await prisma.crmLead.count({
        where: { workspaceId: data.workspaceId, deletedAt: null },
      })
      const lead = await prisma.crmLead.create({ data: { ...data, position } })
      return ok(lead)
    } catch (error) {
      return err(dbError('Failed to create CRM lead', error))
    }
  },

  async update(
    id: string,
    data: {
      name?: string
      emails?: string[]
      phones?: string[]
      company?: string
      jobTitle?: string
      city?: string
      linkedin?: string
      source?: string
      channel?: string
      stage?: CrmLeadStage
      score?: number
      ownerId?: string | null
      convertedPersonId?: string
      closeResult?: 'WON' | 'LOST'
      closedAt?: Date
      contractSignedAt?: Date
      billingType?: 'ONE_TIME' | 'MONTHLY' | 'YEARLY'
      closedAmount?: number
      lostReason?: string
      lostNote?: string
      retryAt?: Date
      updatedById?: string
    },
  ): Promise<Result<CrmLead>> {
    try {
      const lead = await prisma.crmLead.update({ where: { id }, data })
      return ok(lead)
    } catch (error) {
      return err(dbError('Failed to update CRM lead', error))
    }
  },

  async softDelete(id: string): Promise<Result<void>> {
    try {
      await prisma.crmLead.update({
        where: { id },
        data: { deletedAt: new Date() },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete CRM lead', error))
    }
  },

  async reorder(
    workspaceId: string,
    orderedIds: string[],
  ): Promise<Result<void>> {
    try {
      await prisma.$transaction(
        orderedIds.map((id, position) =>
          prisma.crmLead.update({
            where: { id, workspaceId },
            data: { position },
          }),
        ),
      )
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to reorder CRM leads', error))
    }
  },

  // --- 01/02: tentativas e contatos efetivos ---

  async createContactAttempt(data: {
    leadId: string
    workspaceId: string
    createdById: string
    contactedWith: string
    channel: CrmLeadContactChannel
    outcome: CrmLeadContactOutcome
    occurredAt: Date
    note?: string
  }): Promise<Result<CrmLeadContactAttempt>> {
    try {
      const attempt = await prisma.crmLeadContactAttempt.create({ data })
      return ok(attempt)
    } catch (error) {
      return err(dbError('Failed to create CRM lead contact attempt', error))
    }
  },

  async listContactAttempts(
    leadId: string,
  ): Promise<Result<CrmLeadContactAttempt[]>> {
    try {
      const attempts = await prisma.crmLeadContactAttempt.findMany({
        where: { leadId },
        orderBy: { occurredAt: 'desc' },
      })
      return ok(attempts)
    } catch (error) {
      return err(dbError('Failed to list CRM lead contact attempts', error))
    }
  },

  // --- 02: produtos/serviços de interesse ---

  async setInterestProducts(
    leadId: string,
    productIds: string[],
  ): Promise<Result<void>> {
    try {
      await prisma.$transaction([
        prisma.crmLeadInterestProduct.deleteMany({ where: { leadId } }),
        prisma.crmLeadInterestProduct.createMany({
          data: productIds.map((productId) => ({ leadId, productId })),
        }),
      ])
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to set CRM lead interest products', error))
    }
  },

  // --- 03: qualificação (único por lead) ---

  async upsertQualification(data: {
    leadId: string
    qualifiedById: string
    expectedCloseAt?: Date
    decisionMakerName: string
    decisionMakerRole: string
  }): Promise<Result<CrmLeadQualification>> {
    try {
      const qualification = await prisma.crmLeadQualification.upsert({
        where: { leadId: data.leadId },
        create: data,
        update: {
          qualifiedById: data.qualifiedById,
          expectedCloseAt: data.expectedCloseAt,
          decisionMakerName: data.decisionMakerName,
          decisionMakerRole: data.decisionMakerRole,
        },
      })
      return ok(qualification)
    } catch (error) {
      return err(dbError('Failed to upsert CRM lead qualification', error))
    }
  },

  async findQualification(
    leadId: string,
  ): Promise<Result<CrmLeadQualification | null>> {
    try {
      const qualification = await prisma.crmLeadQualification.findUnique({
        where: { leadId },
      })
      return ok(qualification)
    } catch (error) {
      return err(dbError('Failed to find CRM lead qualification', error))
    }
  },

  // --- 04: reuniões ---

  async createMeeting(data: {
    leadId: string
    workspaceId: string
    createdById: string
    scheduledAt: Date
    format: CrmLeadMeetingFormat
    contactPersonId?: string
    contactPersonName?: string
    interestDetails: string
    identifiedNeed: string
  }): Promise<Result<CrmLeadMeeting>> {
    try {
      const meeting = await prisma.crmLeadMeeting.create({ data })
      return ok(meeting)
    } catch (error) {
      return err(dbError('Failed to create CRM lead meeting', error))
    }
  },

  async listMeetings(leadId: string): Promise<Result<CrmLeadMeeting[]>> {
    try {
      const meetings = await prisma.crmLeadMeeting.findMany({
        where: { leadId },
        orderBy: { scheduledAt: 'desc' },
      })
      return ok(meetings)
    } catch (error) {
      return err(dbError('Failed to list CRM lead meetings', error))
    }
  },

  // --- 05: apresentações de proposta ---

  async createProposalPresentation(data: {
    leadId: string
    proposalId: string
    createdById: string
    presentedAt: Date
    format: CrmLeadProposalFormat
    amount: number
    interestLevel: 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH'
    interactionsCount: number
  }): Promise<Result<CrmLeadProposalPresentation>> {
    try {
      const presentation = await prisma.crmLeadProposalPresentation.create({
        data,
      })
      return ok(presentation)
    } catch (error) {
      return err(
        dbError('Failed to create CRM lead proposal presentation', error),
      )
    }
  },

  /** Apresentações do lead — só as da proposta `proposalId`, quando dado. */
  async listProposalPresentations(
    leadId: string,
    proposalId?: string,
  ): Promise<Result<CrmLeadProposalPresentation[]>> {
    try {
      const presentations = await prisma.crmLeadProposalPresentation.findMany({
        where: proposalId ? { leadId, proposalId } : { leadId },
        orderBy: { presentedAt: 'desc' },
      })
      return ok(presentations)
    } catch (error) {
      return err(
        dbError('Failed to list CRM lead proposal presentations', error),
      )
    }
  },

  /**
   * Reabre um lead perdido numa transação: grava o snapshot da perda em
   * `crm_lead_reopenings` e devolve o lead à etapa `toStage` com os campos
   * de fechamento limpos. A leitura dentro da transação garante que só um
   * lead ainda LOST (desta workspace) é reaberto — corrida com outra
   * reabertura/edição cai em CRM_LEAD_REOPEN_NOT_ALLOWED.
   */
  async reopen(
    leadId: string,
    data: {
      workspaceId: string
      toStage: CrmLeadStage
      reason: string
      reopenedById: string
    },
  ): Promise<Result<CrmLead>> {
    try {
      const lead = await prisma.$transaction(async (tx) => {
        const current = await tx.crmLead.findFirst({
          where: {
            id: leadId,
            workspaceId: data.workspaceId,
            closeResult: 'LOST',
            deletedAt: null,
          },
        })
        if (!current) return null

        await tx.crmLeadReopening.create({
          data: {
            leadId,
            workspaceId: data.workspaceId,
            toStage: data.toStage,
            reason: data.reason,
            previousLostReason: current.lostReason,
            previousLostNote: current.lostNote,
            previousClosedAt: current.closedAt,
            previousRetryAt: current.retryAt,
            reopenedById: data.reopenedById,
          },
        })

        return tx.crmLead.update({
          where: { id: leadId },
          data: {
            stage: data.toStage,
            closeResult: null,
            closedAt: null,
            lostReason: null,
            lostNote: null,
            retryAt: null,
            updatedById: data.reopenedById,
          },
        })
      })
      if (!lead) return err(crmLeadReopenNotAllowed())
      return ok(lead)
    } catch (error) {
      return err(dbError('Failed to reopen CRM lead', error))
    }
  },

  async listReopenings(leadId: string): Promise<Result<CrmLeadReopening[]>> {
    try {
      const reopenings = await prisma.crmLeadReopening.findMany({
        where: { leadId },
        orderBy: { createdAt: 'desc' },
      })
      return ok(reopenings)
    } catch (error) {
      return err(dbError('Failed to list CRM lead reopenings', error))
    }
  },
}
