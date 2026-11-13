import type { DocumentSource, Prisma } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { forbidden, validationError } from '@/src/errors'
import {
  documentContentInvalid,
  documentSaveConflict,
  documentTemplateNotFound,
} from '@/src/errors/app-error'
import {
  createEmptyDocumentContent,
  validateDocumentContent,
} from '@/src/lib/canvas-document/catalog'
import { getDocumentStarter } from '@/src/lib/canvas-document/starters'
import {
  defaultProposalValidUntil,
  isProposalValidityPast,
} from '@/src/lib/crm-proposal-validity'
import { newDocumentToken } from '@/src/lib/documents/hash'
import { parseDocumentSettings } from '@/src/lib/documents/settings'
import type { PermissionAction } from '@/src/lib/permissions'
import { err, ok, type Result } from '@/src/lib/result'
import {
  toDocumentDTO,
  toDocumentEventDTO,
  toDocumentListItemDTO,
  toDocumentResponseDTO,
  toDocumentVersionDTO,
} from '@/src/mappers/document.mapper'
import { CrmCompanyRepository } from '@/src/repositories/crm-company.repository'
import { CrmLeadRepository } from '@/src/repositories/crm-lead.repository'
import { CrmOpportunityRepository } from '@/src/repositories/crm-opportunity.repository'
import { CrmPersonRepository } from '@/src/repositories/crm-person.repository'
import {
  type DocumentFull,
  DocumentRepository,
} from '@/src/repositories/document.repository'
import { DocumentEventRepository } from '@/src/repositories/document-event.repository'
import { DocumentResponseRepository } from '@/src/repositories/document-response.repository'
import { DocumentVersionRepository } from '@/src/repositories/document-version.repository'
import type {
  CreateDocumentInput,
  DocumentKindDTO,
  DuplicateDocumentInput,
  ListDocumentsQuery,
  SaveDocumentContentInput,
  UpdateDocumentInput,
} from '@/src/schemas/document.schema'
import type {
  DocumentDTO,
  DocumentEventDTO,
  DocumentListItemDTO,
  DocumentResponseDTO,
  DocumentVersionDTO,
} from '@/types/document'
import { assertMember, assertModuleMember } from './authz'
import { CrmSettingsService } from './crm-settings.service'
import { emitEntityWebhook } from './webhook-entity-events'

/**
 * CRM > Documentos (ADR 0063): documents and templates. Authorization
 * mirrors the legacy proposals: CRM module + the `documents` permission
 * (MEMBER creates and edits, only OWNER/ADMIN delete; re-opening an expired
 * document by changing its validity is OWNER/ADMIN, like extending a
 * proposal).
 */

export interface DocumentListPage {
  items: DocumentListItemDTO[]
  total: number
  page: number
  pageSize: number
}

type CrmLinks = {
  companyId?: string | null
  personId?: string | null
  opportunityId?: string | null
  leadId?: string | null
  ownerId?: string
}

function access(
  actorId: string,
  workspaceId: string,
  action: PermissionAction,
) {
  return assertModuleMember(actorId, workspaceId, 'CRM', {
    resource: 'documents',
    action,
  })
}

/** Linked CRM records and the owner must belong to the workspace. */
async function assertLinks(
  workspaceId: string,
  links: CrmLinks,
): Promise<Result<true>> {
  if (links.companyId) {
    const found = await CrmCompanyRepository.findById(
      links.companyId,
      workspaceId,
    )
    if (!found.ok) return found
  }
  if (links.personId) {
    const found = await CrmPersonRepository.findById(
      links.personId,
      workspaceId,
    )
    if (!found.ok) return found
  }
  if (links.opportunityId) {
    const found = await CrmOpportunityRepository.findById(
      links.opportunityId,
      workspaceId,
    )
    if (!found.ok) return found
  }
  if (links.leadId) {
    const found = await CrmLeadRepository.findById(links.leadId, workspaceId)
    if (!found.ok) return found
  }
  if (links.ownerId) {
    const member = await assertMember(links.ownerId, workspaceId)
    if (!member.ok) return member
  }
  return ok(true)
}

function contentOrError(content: unknown): Result<Prisma.InputJsonValue> {
  const valid = validateDocumentContent(content)
  if (!valid.ok) return err(documentContentInvalid(valid.error))
  return ok(valid.value as unknown as Prisma.InputJsonValue)
}

/** Status an archived document goes back to, from its own history. */
function statusFromHistory(doc: DocumentFull): DocumentFull['status'] {
  if (!doc.currentVersionId) return 'DRAFT'
  if (doc.acceptedAt) return 'ACCEPTED'
  if (doc.declinedAt) return 'DECLINED'
  if (doc.expiredAt) return 'EXPIRED'
  return doc.firstViewedAt ? 'VIEWED' : 'SENT'
}

type Starting = {
  content: unknown
  theme: Prisma.InputJsonValue
  settings: Prisma.InputJsonValue
  kind: DocumentKindDTO
  source: DocumentSource
  templateId: string | null
}

/** Content, theme and settings a new document starts from. */
async function startingPoint(
  workspaceId: string,
  dto: CreateDocumentInput,
): Promise<Result<Starting>> {
  if (dto.templateId) {
    const template = await DocumentRepository.findTemplate(
      dto.templateId,
      workspaceId,
    )
    if (!template.ok) return template
    return ok({
      content: template.value.content,
      theme: template.value.theme as Prisma.InputJsonValue,
      settings: parseDocumentSettings(template.value.settings),
      kind: dto.kind === 'OTHER' ? template.value.kind : dto.kind,
      source: 'TEMPLATE',
      templateId: template.value.id,
    })
  }
  if (dto.starterId) {
    const starter = getDocumentStarter(dto.starterId)
    if (!starter) return err(documentTemplateNotFound())
    return ok({
      content: starter.content,
      theme: starter.theme as Prisma.InputJsonValue,
      settings: parseDocumentSettings({}),
      kind: dto.kind === 'OTHER' ? starter.meta.kind : dto.kind,
      source: 'TEMPLATE',
      templateId: null,
    })
  }
  return ok({
    content: createEmptyDocumentContent(),
    theme: {},
    settings: parseDocumentSettings({}),
    kind: dto.kind,
    source: 'BLANK',
    templateId: null,
  })
}

/** Proposals get the workspace's default validity, like the legacy ones. */
async function defaultValidUntil(
  workspaceId: string,
  kind: DocumentKindDTO,
  isTemplate: boolean,
): Promise<Result<Date | null>> {
  if (kind !== 'PROPOSAL' || isTemplate) return ok(null)
  const settings = await CrmSettingsService.resolve(workspaceId)
  if (!settings.ok) return settings
  return ok(
    defaultProposalValidUntil(new Date(), settings.value.proposalValidityDays),
  )
}

function copyTitle(title: string, asTemplate: boolean): string {
  const prefix = asTemplate ? 'Modelo: ' : 'Cópia de '
  return `${prefix}${title}`.slice(0, 200)
}

export const DocumentService = {
  async list(
    actorId: string,
    workspaceId: string,
    query: ListDocumentsQuery,
  ): Promise<Result<DocumentListPage>> {
    const membership = await access(actorId, workspaceId, 'VIEW')
    if (!membership.ok) return membership

    const result = await DocumentRepository.list(workspaceId, query)
    if (!result.ok) return result

    return ok({
      items: result.value.items.map(toDocumentListItemDTO),
      total: result.value.total,
      page: query.page,
      pageSize: query.pageSize,
    })
  },

  async get(
    actorId: string,
    workspaceId: string,
    documentId: string,
  ): Promise<Result<DocumentDTO>> {
    const membership = await access(actorId, workspaceId, 'VIEW')
    if (!membership.ok) return membership

    const result = await DocumentRepository.findById(documentId, workspaceId)
    if (!result.ok) return result

    return ok(toDocumentDTO(result.value))
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateDocumentInput,
  ): Promise<Result<DocumentDTO>> {
    const membership = await access(actorId, workspaceId, 'CREATE')
    if (!membership.ok) return membership

    const links = await assertLinks(workspaceId, dto)
    if (!links.ok) return links

    const start = await startingPoint(workspaceId, dto)
    if (!start.ok) return start

    const content = contentOrError(start.value.content)
    if (!content.ok) return content

    let validUntil = dto.validUntil ?? null
    if (dto.validUntil === undefined) {
      const fallback = await defaultValidUntil(
        workspaceId,
        start.value.kind,
        dto.isTemplate,
      )
      if (!fallback.ok) return fallback
      validUntil = fallback.value
    }

    const result = await DocumentRepository.create({
      workspaceId,
      kind: start.value.kind,
      title: dto.title,
      description: dto.description ?? null,
      isTemplate: dto.isTemplate,
      templateId: start.value.templateId,
      source: start.value.source,
      content: content.value,
      theme: start.value.theme,
      settings: start.value.settings,
      publicToken: newDocumentToken(),
      validUntil: dto.isTemplate ? null : validUntil,
      companyId: dto.companyId ?? null,
      personId: dto.personId ?? null,
      opportunityId: dto.opportunityId ?? null,
      leadId: dto.leadId ?? null,
      ownerId: dto.ownerId ?? actorId,
      createdById: actorId,
    })
    if (!result.ok) {
      auditMutation({
        entity: 'document',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: result.error.code,
      })
      return result
    }

    await DocumentEventRepository.createMany([
      {
        documentId: result.value.id,
        workspaceId,
        type: 'CREATED',
        actorId,
        data: { source: start.value.source },
      },
    ])
    auditMutation({
      entity: 'document',
      action: 'create',
      actorId,
      targetId: result.value.id,
      meta: {
        workspaceId,
        kind: result.value.kind,
        isTemplate: result.value.isTemplate,
        source: start.value.source,
      },
    })
    const created = toDocumentDTO(result.value)
    void emitEntityWebhook(workspaceId, actorId, {
      entity: 'document',
      action: 'created',
      record: created,
    })
    return ok(created)
  },

  async update(
    actorId: string,
    workspaceId: string,
    documentId: string,
    dto: UpdateDocumentInput,
  ): Promise<Result<DocumentDTO>> {
    const membership = await access(actorId, workspaceId, 'EDIT')
    if (!membership.ok) return membership

    const existing = await DocumentRepository.findById(documentId, workspaceId)
    if (!existing.ok) return existing
    const current = existing.value

    const links = await assertLinks(workspaceId, dto)
    if (!links.ok) return links

    const data: Prisma.DocumentUncheckedUpdateInput = {
      title: dto.title,
      description: dto.description,
      kind: dto.kind,
      ownerId: dto.ownerId,
      linkEnabled: dto.linkEnabled,
      companyId: dto.companyId,
      personId: dto.personId,
      opportunityId: dto.opportunityId,
      leadId: dto.leadId,
      updatedById: actorId,
    }
    if (dto.theme !== undefined) {
      data.theme = dto.theme as Prisma.InputJsonValue
    }
    if (dto.settings !== undefined) {
      data.settings = {
        ...parseDocumentSettings(current.settings),
        ...dto.settings,
      }
    }

    if (dto.validUntil !== undefined) {
      const changed =
        (dto.validUntil?.getTime() ?? null) !==
        (current.validUntil?.getTime() ?? null)
      if (changed && current.status === 'EXPIRED') {
        // Re-opening an expired document = extending it (OWNER/ADMIN).
        if (!membership.value.isPrivileged) {
          return err(
            forbidden(
              'Só administradores do CRM podem alterar a validade de um documento expirado',
            ),
          )
        }
        if (!dto.validUntil || isProposalValidityPast(dto.validUntil)) {
          return err(
            validationError('A nova validade precisa ser uma data futura'),
          )
        }
        data.status = current.firstViewedAt ? 'VIEWED' : 'SENT'
        data.expiredAt = null
      }
      data.validUntil = dto.validUntil
    }

    if (dto.status === 'ARCHIVED' && current.status !== 'ARCHIVED') {
      data.status = 'ARCHIVED'
    } else if (dto.status === 'DRAFT' && current.status === 'ARCHIVED') {
      data.status = statusFromHistory(current)
    }

    const result = await DocumentRepository.update(documentId, data)
    if (!result.ok) return result

    auditMutation({
      entity: 'document',
      action: data.status === 'ARCHIVED' ? 'archive' : 'update',
      actorId,
      targetId: documentId,
      meta: { workspaceId, fields: Object.keys(dto) },
    })
    const updated = toDocumentDTO(result.value)
    void emitEntityWebhook(workspaceId, actorId, {
      entity: 'document',
      action: 'updated',
      record: updated,
    })
    return ok(updated)
  },

  async saveContent(
    actorId: string,
    workspaceId: string,
    documentId: string,
    dto: SaveDocumentContentInput,
  ): Promise<Result<{ updatedAt: string }>> {
    const membership = await access(actorId, workspaceId, 'EDIT')
    if (!membership.ok) return membership

    const existing = await DocumentRepository.findMeta(documentId, workspaceId)
    if (!existing.ok) return existing

    const content = contentOrError(dto.content)
    if (!content.ok) return content

    const saved = await DocumentRepository.saveContent(documentId, {
      content: content.value,
      theme: dto.theme as Prisma.InputJsonValue | undefined,
      updatedById: actorId,
      baseUpdatedAt: dto.baseUpdatedAt,
    })
    if (!saved.ok) return saved
    if (!saved.value) return err(documentSaveConflict())

    return ok({ updatedAt: saved.value.toISOString() })
  },

  async duplicate(
    actorId: string,
    workspaceId: string,
    documentId: string,
    dto: DuplicateDocumentInput,
  ): Promise<Result<DocumentDTO>> {
    const membership = await access(actorId, workspaceId, 'CREATE')
    if (!membership.ok) return membership

    const existing = await DocumentRepository.findById(documentId, workspaceId)
    if (!existing.ok) return existing
    const source = existing.value

    const asTemplate = dto.asTemplate ?? source.isTemplate
    const fromTemplate = source.isTemplate && !asTemplate
    const result = await DocumentRepository.create({
      workspaceId,
      kind: source.kind,
      title: dto.title ?? copyTitle(source.title, asTemplate),
      description: source.description,
      isTemplate: asTemplate,
      templateId: fromTemplate ? source.id : source.templateId,
      source: fromTemplate ? 'TEMPLATE' : 'DUPLICATE',
      content: source.content as Prisma.InputJsonValue,
      theme: source.theme as Prisma.InputJsonValue,
      settings: parseDocumentSettings(source.settings),
      publicToken: newDocumentToken(),
      companyId: asTemplate ? null : source.companyId,
      personId: asTemplate ? null : source.personId,
      opportunityId: asTemplate ? null : source.opportunityId,
      leadId: asTemplate ? null : source.leadId,
      ownerId: actorId,
      createdById: actorId,
    })
    if (!result.ok) return result

    await DocumentEventRepository.createMany([
      {
        documentId: result.value.id,
        workspaceId,
        type: 'CREATED',
        actorId,
        data: { source: 'DUPLICATE', fromDocumentId: source.id },
      },
    ])
    auditMutation({
      entity: 'document',
      action: 'duplicate',
      actorId,
      targetId: result.value.id,
      meta: { workspaceId, fromDocumentId: source.id, asTemplate },
    })
    return ok(toDocumentDTO(result.value))
  },

  async remove(
    actorId: string,
    workspaceId: string,
    documentId: string,
  ): Promise<Result<void>> {
    const membership = await access(actorId, workspaceId, 'DELETE')
    if (!membership.ok) return membership

    const existing = await DocumentRepository.findById(documentId, workspaceId)
    if (!existing.ok) return existing

    const result = await DocumentRepository.softDelete(documentId)
    if (!result.ok) return result

    auditMutation({
      entity: 'document',
      action: 'delete',
      actorId,
      targetId: documentId,
      meta: { workspaceId },
    })
    void emitEntityWebhook(workspaceId, actorId, {
      entity: 'document',
      action: 'deleted',
      record: toDocumentDTO(existing.value),
    })
    return ok(undefined)
  },

  async listVersions(
    actorId: string,
    workspaceId: string,
    documentId: string,
  ): Promise<Result<DocumentVersionDTO[]>> {
    const membership = await access(actorId, workspaceId, 'VIEW')
    if (!membership.ok) return membership
    const existing = await DocumentRepository.findMeta(documentId, workspaceId)
    if (!existing.ok) return existing

    const result = await DocumentVersionRepository.listByDocument(documentId)
    if (!result.ok) return result
    return ok(result.value.map(toDocumentVersionDTO))
  },

  async listEvents(
    actorId: string,
    workspaceId: string,
    documentId: string,
  ): Promise<Result<DocumentEventDTO[]>> {
    const membership = await access(actorId, workspaceId, 'VIEW')
    if (!membership.ok) return membership
    const existing = await DocumentRepository.findMeta(documentId, workspaceId)
    if (!existing.ok) return existing

    const result = await DocumentEventRepository.listByDocument(documentId)
    if (!result.ok) return result
    return ok(result.value.map(toDocumentEventDTO))
  },

  async listResponses(
    actorId: string,
    workspaceId: string,
    documentId: string,
  ): Promise<Result<DocumentResponseDTO[]>> {
    const membership = await access(actorId, workspaceId, 'VIEW')
    if (!membership.ok) return membership
    const existing = await DocumentRepository.findMeta(documentId, workspaceId)
    if (!existing.ok) return existing

    const result = await DocumentResponseRepository.listByDocument(documentId)
    if (!result.ok) return result
    return ok(result.value.map(toDocumentResponseDTO))
  },
}
