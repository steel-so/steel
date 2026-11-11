import { randomBytes } from 'node:crypto'
import type { Document, DocumentStatus, Prisma } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import {
  documentContentInvalid,
  documentTemplateNotFound,
} from '@/src/errors/app-error'
import type { DocumentPricingItem } from '@/src/lib/canvas-document/context'
import { buildNewProposal } from '@/src/lib/canvas-document/convert-proposal'
import { pricingLineTotal } from '@/src/lib/canvas-document/pricing'
import { defaultProposalValidUntil } from '@/src/lib/crm-proposal-validity'
import { err, ok, type Result } from '@/src/lib/result'
import { indexSearchDocument } from '@/src/lib/search/index-hooks'
import { toCrmDocumentSummaryDTO } from '@/src/mappers/document-crm.mapper'
import { CrmCompanyRepository } from '@/src/repositories/crm-company.repository'
import { CrmLeadRepository } from '@/src/repositories/crm-lead.repository'
import {
  CrmOpportunityLineItemRepository,
  CrmOpportunityRepository,
} from '@/src/repositories/crm-opportunity.repository'
import { CrmPersonRepository } from '@/src/repositories/crm-person.repository'
import { DocumentCrmRepository } from '@/src/repositories/document-crm.repository'
import { DEFAULT_DOCUMENT_SETTINGS } from '@/src/schemas/document.schema'
import type { CrmDocumentSummaryDTO } from '@/types/crm-document-summary'
import { assertMember, assertModuleMember } from './authz'
import { CrmSettingsService } from './crm-settings.service'

/**
 * Proposals created from the CRM outside CRM > Documentos (ADR 0063): the
 * lead pipeline ("Criar e avançar para Proposta"), opportunities, renewals
 * and Steel AI. A proposal is a document of kind PROPOSAL; without a
 * template it starts with a cover, the opportunity line items as a pricing
 * table and the accept section. Same rules as CRM > Documentos: CRM module
 * on, the `documents` permission, links inside the workspace.
 */

export interface CreateCrmProposalDocumentInput {
  title: string
  /** A document template (`isTemplate`) of the workspace. */
  templateId?: string | null
  companyId?: string | null
  personId?: string | null
  opportunityId?: string | null
  leadId?: string | null
  ownerId?: string
  /** Missing = today + the workspace default validity. */
  validUntil?: Date | null
}

export interface ListCrmDocumentsFilter {
  status?: DocumentStatus
  leadId?: string
  opportunityId?: string
  isTemplate?: boolean
  take?: number
}

const LIST_MAX = 200

const RECURRENCE = {
  ONE_TIME: 'once',
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
} as const

function newPublicToken(): string {
  return randomBytes(32).toString('base64url')
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Opportunity line items → pricing lines of the new proposal. */
async function opportunityItems(
  opportunityId: string | null | undefined,
): Promise<Result<DocumentPricingItem[]>> {
  if (!opportunityId) return ok([])
  const rows =
    await CrmOpportunityLineItemRepository.listByOpportunity(opportunityId)
  if (!rows.ok) return rows
  return ok(
    rows.value.map((row, index) => {
      const discountPct = Number(row.discountPct)
      return {
        id: `item-${index + 1}`,
        productId: row.productId,
        name: row.name,
        unitPrice: Number(row.unitPrice),
        quantity: row.quantity,
        ...(discountPct > 0 ? { discountPct } : {}),
        recurrence: RECURRENCE[row.billingType],
      }
    }),
  )
}

/**
 * Checks every CRM link belongs to the workspace and returns the name the
 * cover shows: company, else person, else lead.
 */
async function checkLinks(
  workspaceId: string,
  input: CreateCrmProposalDocumentInput,
): Promise<Result<string | null>> {
  let client: string | null = null
  if (input.leadId) {
    const lead = await CrmLeadRepository.findById(input.leadId, workspaceId)
    if (!lead.ok) return lead
    client = lead.value.name
  }
  if (input.personId) {
    const person = await CrmPersonRepository.findById(
      input.personId,
      workspaceId,
    )
    if (!person.ok) return person
    client = person.value.name
  }
  if (input.companyId) {
    const company = await CrmCompanyRepository.findById(
      input.companyId,
      workspaceId,
    )
    if (!company.ok) return company
    client = company.value.name
  }
  if (input.opportunityId) {
    const opportunity = await CrmOpportunityRepository.findById(
      input.opportunityId,
      workspaceId,
    )
    if (!opportunity.ok) return opportunity
  }
  return ok(client)
}

async function resolveValidUntil(
  workspaceId: string,
  validUntil: Date | null | undefined,
): Promise<Result<Date | null>> {
  if (validUntil !== undefined) return ok(validUntil)
  const settings = await CrmSettingsService.resolve(workspaceId)
  if (!settings.ok) return settings
  return ok(
    defaultProposalValidUntil(new Date(), settings.value.proposalValidityDays),
  )
}

export const DocumentCrmService = {
  async createProposal(
    actorId: string,
    workspaceId: string,
    input: CreateCrmProposalDocumentInput,
  ): Promise<Result<CrmDocumentSummaryDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'documents',
      action: 'CREATE',
    })
    if (!membership.ok) return membership

    const clientName = await checkLinks(workspaceId, input)
    if (!clientName.ok) return clientName
    const ownerId = input.ownerId ?? actorId
    if (ownerId !== actorId) {
      const owner = await assertMember(ownerId, workspaceId)
      if (!owner.ok) return owner
    }

    const validUntil = await resolveValidUntil(workspaceId, input.validUntil)
    if (!validUntil.ok) return validUntil

    let built: {
      content: Prisma.InputJsonValue
      theme: Prisma.InputJsonValue
      settings: Prisma.InputJsonValue
      templateId: string | null
      totalValue: number | null
    }
    if (input.templateId) {
      const template = await DocumentCrmRepository.findById(
        input.templateId,
        workspaceId,
      )
      if (!template.ok) return template
      if (!template.value?.isTemplate) return err(documentTemplateNotFound())
      built = {
        content: template.value.content as unknown as Prisma.InputJsonValue,
        theme: template.value.theme as unknown as Prisma.InputJsonValue,
        settings: template.value.settings as unknown as Prisma.InputJsonValue,
        templateId: template.value.id,
        totalValue:
          template.value.totalValue === null
            ? null
            : Number(template.value.totalValue),
      }
    } else {
      const items = await opportunityItems(input.opportunityId)
      if (!items.ok) return items
      let outline: ReturnType<typeof buildNewProposal>
      try {
        outline = buildNewProposal({
          title: input.title,
          clientName: clientName.value,
          items: items.value,
          hasValidity: validUntil.value !== null,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return err(documentContentInvalid(message))
      }
      const total = items.value.reduce(
        (sum, item) => sum + pricingLineTotal(item),
        0,
      )
      built = {
        content: outline.content as unknown as Prisma.InputJsonValue,
        theme: outline.theme as unknown as Prisma.InputJsonValue,
        settings: DEFAULT_DOCUMENT_SETTINGS as unknown as Prisma.InputJsonValue,
        templateId: null,
        totalValue: items.value.length > 0 ? round2(total) : null,
      }
    }

    const created = await DocumentCrmRepository.create({
      workspaceId,
      kind: 'PROPOSAL',
      title: input.title,
      templateId: built.templateId,
      source: built.templateId ? 'TEMPLATE' : 'BLANK',
      content: built.content,
      theme: built.theme,
      settings: built.settings,
      companyId: input.companyId ?? null,
      personId: input.personId ?? null,
      opportunityId: input.opportunityId ?? null,
      leadId: input.leadId ?? null,
      ownerId,
      createdById: actorId,
      validUntil: validUntil.value,
      publicToken: newPublicToken(),
      totalValue: built.totalValue,
    })
    if (!created.ok) {
      auditMutation({
        entity: 'document',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: created.error.code,
      })
      return created
    }

    auditMutation({
      entity: 'document',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: {
        workspaceId,
        kind: 'PROPOSAL',
        leadId: input.leadId ?? null,
        opportunityId: input.opportunityId ?? null,
      },
    })
    void indexSearchDocument('crm-document', workspaceId, created.value.id)
    return ok(toCrmDocumentSummaryDTO(created.value))
  },

  /**
   * "Gerar proposta" of an opportunity (and of a renewal deal): a proposal
   * linked to the deal, its company and point of contact, priced with the
   * deal's line items.
   */
  async createForOpportunity(
    actorId: string,
    workspaceId: string,
    opportunityId: string,
    input: { title?: string; templateId?: string | null } = {},
  ): Promise<Result<CrmDocumentSummaryDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'documents',
      action: 'CREATE',
    })
    if (!membership.ok) return membership

    const opportunity = await CrmOpportunityRepository.findById(
      opportunityId,
      workspaceId,
    )
    if (!opportunity.ok) return opportunity
    const deal = opportunity.value

    return DocumentCrmService.createProposal(actorId, workspaceId, {
      title: input.title?.trim() || `Proposta — ${deal.name}`,
      templateId: input.templateId,
      opportunityId,
      companyId: deal.companyId,
      personId: deal.pointOfContactId,
    })
  },

  /** Proposals (or proposal templates) of the workspace, newest first. */
  async listProposals(
    actorId: string,
    workspaceId: string,
    filter: ListCrmDocumentsFilter = {},
  ): Promise<Result<CrmDocumentSummaryDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'documents',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const rows = await DocumentCrmRepository.list(workspaceId, {
      kind: 'PROPOSAL',
      status: filter.status,
      isTemplate: filter.isTemplate,
      leadId: filter.leadId,
      opportunityId: filter.opportunityId,
      take: Math.min(filter.take ?? LIST_MAX, LIST_MAX),
    })
    if (!rows.ok) return rows
    return ok(rows.value.map(toCrmDocumentSummaryDTO))
  },

  /** Newest live proposal of a lead. Callers check the permission. */
  latestProposalForLead(
    workspaceId: string,
    leadId: string,
  ): Promise<Result<Document | null>> {
    return DocumentCrmRepository.latestProposalByLead(leadId, workspaceId)
  },

  /** Live document of the workspace. Callers check the permission. */
  findInWorkspace(
    workspaceId: string,
    documentId: string,
  ): Promise<Result<Document | null>> {
    return DocumentCrmRepository.findById(documentId, workspaceId)
  },
}
