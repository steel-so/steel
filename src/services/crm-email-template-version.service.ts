import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { crmEmailTemplateNotBuilder } from '@/src/errors'
import { isEmailCanvasDocument } from '@/src/lib/canvas-email/convert-v1'
import { err, ok, type Result } from '@/src/lib/result'
import {
  toCrmEmailTemplateVersionDetailDTO,
  toCrmEmailTemplateVersionDTO,
} from '@/src/mappers/crm-email-editor.mapper'
import { CrmEmailTemplateRepository } from '@/src/repositories/crm-email-template.repository'
import { CrmEmailTemplateVersionRepository } from '@/src/repositories/crm-email-template-version.repository'
import type { EmailCanvasDocument } from '@/src/schemas/crm-email-builder.schema'
import type { CreateCrmEmailTemplateVersionDTO } from '@/src/schemas/crm-email-editor.schema'
import type {
  CrmEmailTemplateRestoreDTO,
  CrmEmailTemplateVersionDetailDTO,
  CrmEmailTemplateVersionDTO,
} from '@/types/crm-email-editor'
import { assertModuleMember } from './authz'
import { CrmEmailTemplateService } from './crm-email-template.service'
import { recordTemplateVersion } from './crm-email-template-history'

/**
 * Version history of v2 (Steel Canvas) e-mail templates: list, preview,
 * "Salvar versão" and restore. Versions are also recorded on test sends and
 * campaign use (`crm-email-template-history.ts`). The newest 50 are kept.
 */

const VIEW = { resource: 'email', action: 'VIEW' } as const
const EDIT = { resource: 'email', action: 'EDIT' } as const

export const CrmEmailTemplateVersionService = {
  async list(
    actorId: string,
    workspaceId: string,
    templateId: string,
  ): Promise<Result<CrmEmailTemplateVersionDTO[]>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'CRM',
      VIEW,
    )
    if (!membership.ok) return membership
    const template = await CrmEmailTemplateRepository.findById(
      templateId,
      workspaceId,
    )
    if (!template.ok) return template

    const versions = await CrmEmailTemplateVersionRepository.list(
      templateId,
      workspaceId,
    )
    if (!versions.ok) return versions
    return ok(versions.value.map(toCrmEmailTemplateVersionDTO))
  },

  async get(
    actorId: string,
    workspaceId: string,
    templateId: string,
    versionId: string,
  ): Promise<Result<CrmEmailTemplateVersionDetailDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'CRM',
      VIEW,
    )
    if (!membership.ok) return membership
    const version = await CrmEmailTemplateVersionRepository.findById(
      versionId,
      templateId,
      workspaceId,
    )
    if (!version.ok) return version
    return ok(toCrmEmailTemplateVersionDetailDTO(version.value))
  },

  /** "Salvar versão": the template as stored now. `null` when nothing
   * changed since the newest version. */
  async create(
    actorId: string,
    workspaceId: string,
    templateId: string,
    dto: CreateCrmEmailTemplateVersionDTO,
  ): Promise<Result<CrmEmailTemplateVersionDTO | null>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'CRM',
      EDIT,
    )
    if (!membership.ok) return membership
    const template = await CrmEmailTemplateRepository.findById(
      templateId,
      workspaceId,
    )
    if (!template.ok) return template
    if (!isEmailCanvasDocument(template.value.builderDocument)) {
      return err(crmEmailTemplateNotBuilder())
    }

    const recorded = await recordTemplateVersion(template.value, {
      reason: 'SAVE',
      actorId,
      label: dto.label || null,
    })
    if (!recorded.ok) return recorded
    return ok(recorded.value && toCrmEmailTemplateVersionDTO(recorded.value))
  },

  /**
   * Puts a version back: the template is saved with the version's document
   * and subject through the regular update (same validation and HTML-block
   * rule), then a RESTORE version marks it in the history.
   */
  async restore(
    actorId: string,
    workspaceId: string,
    templateId: string,
    versionId: string,
  ): Promise<Result<CrmEmailTemplateRestoreDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'CRM',
      EDIT,
    )
    if (!membership.ok) return membership
    const version = await CrmEmailTemplateVersionRepository.findById(
      versionId,
      templateId,
      workspaceId,
    )
    if (!version.ok) return version

    const updated = await CrmEmailTemplateService.update(
      actorId,
      workspaceId,
      templateId,
      {
        builderDocument: version.value
          .document as unknown as EmailCanvasDocument,
        subject: version.value.subject,
      },
    )
    if (!updated.ok) return updated

    const template = await CrmEmailTemplateRepository.findById(
      templateId,
      workspaceId,
    )
    if (!template.ok) return template
    const recorded = await recordTemplateVersion(template.value, {
      reason: 'RESTORE',
      actorId,
      label: version.value.label,
      restoredFromId: version.value.id,
    })
    if (!recorded.ok) return recorded

    auditMutation({
      entity: 'crm_email_template',
      action: 'restore',
      actorId,
      targetId: templateId,
      meta: { workspaceId, versionId },
    })
    logger.info('crm_email_template.version_restored', {
      component: 'CrmEmailTemplateVersionService',
      workspaceId,
      templateId,
      versionId,
    })
    return ok({
      template: updated.value,
      // A restore always records (no hash dedupe).
      version: toCrmEmailTemplateVersionDTO(
        recorded.value as NonNullable<typeof recorded.value>,
      ),
    })
  },
}
