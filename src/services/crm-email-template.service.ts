import type { CrmEmailTemplate, Prisma } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import {
  crmEmailBuilderStructureLocked,
  crmEmailTemplateNotBuilder,
} from '@/src/errors'
import {
  createEmailDocumentFromLayout,
  isEmailCanvasDocument,
} from '@/src/lib/canvas-email/convert-v1'
import { createBuilderDocument } from '@/src/lib/crm-email-builder/layouts'
import { renderMarketingTemplate } from '@/src/lib/crm-marketing-templates.render'
import { err, ok, type Result } from '@/src/lib/result'
import { toCrmEmailTemplateDTO } from '@/src/mappers/crm-email-marketing.mapper'
import { CrmEmailTemplateRepository } from '@/src/repositories/crm-email-template.repository'
import type {
  EmailBuilderDocument,
  EmailBuilderLayoutId,
  EmailCanvasDocument,
} from '@/src/schemas/crm-email-builder.schema'
import type {
  CreateCrmEmailTemplateDTO,
  UpdateCrmEmailTemplateDTO,
} from '@/src/schemas/crm-email-template.schema'
import type { CrmEmailTemplateDTO } from '@/types/crm-email-marketing'
import { assertModuleMember } from './authz'
import {
  type BuilderTemplateDocument,
  buildBuilderTemplateContent,
} from './crm-email-builder.service'

/** Layout fixo informado: HTML é sempre recalculado a partir dele, ignorando
 * qualquer `contentHtml` vindo do editor de blocos livre. */
async function resolveContentHtml(dto: {
  contentHtml?: string
  templateId?: string
  templateProps?: Record<string, string>
}): Promise<string> {
  if (dto.templateId) {
    return renderMarketingTemplate(
      dto.templateId as Parameters<typeof renderMarketingTemplate>[0],
      dto.templateProps,
    )
  }
  return dto.contentHtml ?? ''
}

export const CrmEmailTemplateService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<CrmEmailTemplateDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'email',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const result = await CrmEmailTemplateRepository.listByWorkspace(workspaceId)
    if (!result.ok) return result

    return ok(result.value.map(toCrmEmailTemplateDTO))
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateCrmEmailTemplateDTO,
  ): Promise<Result<CrmEmailTemplateDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'email',
      action: 'CREATE',
    })
    if (!membership.ok) return membership

    let data: Parameters<typeof CrmEmailTemplateRepository.create>[0]
    if (dto.builderDocument || dto.builderLayout) {
      // Visual builder: a ready Steel Canvas document, or the layout's
      // default content as a locked v1 layout or (builderVersion 2) a Steel
      // Canvas document.
      const built = await buildBuilderTemplateContent(
        workspaceId,
        dto.builderDocument ??
          (dto.builderVersion === 2
            ? (createEmailDocumentFromLayout(
                dto.builderLayout as EmailBuilderLayoutId,
              ) as unknown as EmailCanvasDocument)
            : createBuilderDocument(dto.builderLayout as EmailBuilderLayoutId)),
        dto.subject,
        { privileged: membership.value.isPrivileged },
      )
      if (!built.ok) return built
      data = {
        workspaceId,
        createdById: actorId,
        name: dto.name,
        subject: dto.subject,
        kind: 'BUILDER',
        builderDocument: built.value.document as Prisma.InputJsonValue,
        contentHtml: built.value.html,
        contentText: built.value.text,
      }
    } else {
      data = {
        workspaceId,
        createdById: actorId,
        name: dto.name,
        subject: dto.subject,
        contentHtml: await resolveContentHtml(dto),
        contentJson: dto.contentJson,
        templateId: dto.templateId,
        templateProps: dto.templateProps,
      }
    }

    const result = await CrmEmailTemplateRepository.create(data)

    if (!result.ok) {
      auditMutation({
        entity: 'crm_email_template',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: result.error.code,
      })
      return result
    }

    auditMutation({
      entity: 'crm_email_template',
      action: 'create',
      actorId,
      targetId: result.value.id,
    })

    return ok(toCrmEmailTemplateDTO(result.value))
  },

  async update(
    actorId: string,
    workspaceId: string,
    templateId: string,
    dto: UpdateCrmEmailTemplateDTO,
  ): Promise<Result<CrmEmailTemplateDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'email',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const existing = await CrmEmailTemplateRepository.findById(
      templateId,
      workspaceId,
    )
    if (!existing.ok) return existing

    if (existing.value.kind === 'BUILDER') {
      return updateBuilderTemplate(
        actorId,
        workspaceId,
        existing.value,
        dto,
        membership.value.isPrivileged,
      )
    }
    if (dto.builderDocument) return err(crmEmailTemplateNotBuilder())

    // Só recalcula o HTML a partir do layout fixo quando o layout ou seus
    // campos mudaram — do contrário, mantém o contentHtml enviado (edição
    // livre) ou não mexe nele (undefined = campo não alterado).
    const nextTemplateId = dto.templateId ?? existing.value.templateId
    const contentHtml =
      dto.templateId || dto.templateProps
        ? await resolveContentHtml({
            templateId: nextTemplateId ?? undefined,
            templateProps:
              (dto.templateProps as Record<string, string> | undefined) ??
              (existing.value.templateProps as
                | Record<string, string>
                | undefined),
          })
        : dto.contentHtml

    const result = await CrmEmailTemplateRepository.update(templateId, {
      name: dto.name,
      subject: dto.subject,
      contentHtml,
      contentJson: dto.contentJson,
      templateId: dto.templateId,
      templateProps: dto.templateProps,
      updatedById: actorId,
    })
    if (!result.ok) return result

    auditMutation({
      entity: 'crm_email_template',
      action: 'update',
      actorId,
      targetId: templateId,
      meta: { fields: Object.keys(dto) },
    })

    return ok(toCrmEmailTemplateDTO(result.value))
  },

  async getById(
    actorId: string,
    workspaceId: string,
    templateId: string,
  ): Promise<Result<CrmEmailTemplateDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'email',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const result = await CrmEmailTemplateRepository.findById(
      templateId,
      workspaceId,
    )
    if (!result.ok) return result
    return ok(toCrmEmailTemplateDTO(result.value))
  },

  async remove(
    actorId: string,
    workspaceId: string,
    templateId: string,
  ): Promise<Result<void>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'email',
      action: 'DELETE',
    })
    if (!membership.ok) return membership

    const existing = await CrmEmailTemplateRepository.findById(
      templateId,
      workspaceId,
    )
    if (!existing.ok) return existing

    const result = await CrmEmailTemplateRepository.softDelete(templateId)
    if (!result.ok) return result

    auditMutation({
      entity: 'crm_email_template',
      action: 'delete',
      actorId,
      targetId: templateId,
    })

    return ok(undefined)
  },

  /** Renderiza um layout fixo com os campos em edição, para o preview ao
   * vivo do formulário — sem persistir nada. */
  async previewLayout(
    actorId: string,
    workspaceId: string,
    dto: { templateId: string; templateProps?: Record<string, string> },
  ): Promise<Result<{ html: string }>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'email',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const html = await resolveContentHtml(dto)
    return ok({ html })
  },
}

/**
 * Saves a visual-builder template: content edits (autosave), subject or
 * name. A v1 document keeps its layout and locked structure; a v2 (Steel
 * Canvas) document is validated against the e-mail catalog. A template may
 * move from v1 to v2, never back. Free HTML is refused.
 */
async function updateBuilderTemplate(
  actorId: string,
  workspaceId: string,
  existing: CrmEmailTemplate,
  dto: UpdateCrmEmailTemplateDTO,
  privileged: boolean,
): Promise<Result<CrmEmailTemplateDTO>> {
  if (dto.contentHtml || dto.templateId || dto.templateProps) {
    return err(
      crmEmailBuilderStructureLocked(
        'Templates do editor visual são editados no editor',
      ),
    )
  }
  const current = existing.builderDocument as unknown as BuilderTemplateDocument
  const next = dto.builderDocument as BuilderTemplateDocument | undefined
  if (next && !isEmailCanvasDocument(next)) {
    if (isEmailCanvasDocument(current)) {
      return err(
        crmEmailBuilderStructureLocked(
          'Este template já usa o novo editor e não pode voltar para o modelo antigo',
        ),
      )
    }
    if (
      (next as EmailBuilderDocument).layout !==
      (current as EmailBuilderDocument).layout
    ) {
      return err(
        crmEmailBuilderStructureLocked(
          'O modelo de um template não pode mudar',
        ),
      )
    }
  }

  let rendered: {
    builderDocument?: Prisma.InputJsonValue
    contentHtml?: string
    contentText?: string
  } = {}
  if (next || dto.subject) {
    const built = await buildBuilderTemplateContent(
      workspaceId,
      next ?? current,
      dto.subject ?? existing.subject,
      { privileged, previous: current },
    )
    if (!built.ok) return built
    rendered = {
      builderDocument: built.value.document as Prisma.InputJsonValue,
      contentHtml: built.value.html,
      contentText: built.value.text,
    }
  }

  const result = await CrmEmailTemplateRepository.update(existing.id, {
    name: dto.name,
    subject: dto.subject,
    ...rendered,
    updatedById: actorId,
  })
  if (!result.ok) return result

  auditMutation({
    entity: 'crm_email_template',
    action: 'update',
    actorId,
    targetId: existing.id,
    meta: {
      fields: Object.keys(dto),
      kind: 'BUILDER',
      version: isEmailCanvasDocument(next ?? current) ? 2 : 1,
    },
  })

  return ok(toCrmEmailTemplateDTO(result.value))
}
