import type { Prisma } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  crmEmailCanvasHtmlForbidden,
  crmEmailSavedBlockInvalid,
  crmEmailSavedBlockLimitReached,
} from '@/src/errors'
import { validateEmailFragment } from '@/src/lib/canvas-email/fragments'
import { err, ok, type Result } from '@/src/lib/result'
import { toCrmEmailSavedBlockDTO } from '@/src/mappers/crm-email-editor.mapper'
import { CrmEmailSavedBlockRepository } from '@/src/repositories/crm-email-saved-block.repository'
import type {
  CreateCrmEmailSavedBlockDTO,
  UpdateCrmEmailSavedBlockDTO,
} from '@/src/schemas/crm-email-editor.schema'
import type { CrmEmailSavedBlockDTO } from '@/types/crm-email-editor'
import { assertModuleMember } from './authz'

/**
 * Saved blocks of the e-mail editor ("Salvos", E2): a section or a block
 * saved once and dragged into any template of the workspace. The fragment
 * is validated by the e-mail catalog before it is stored; only workspace
 * admins may save one with an HTML block (same rule as templates).
 */

/** Saved blocks per workspace. */
export const SAVED_BLOCK_LIMIT = 200

export const CrmEmailSavedBlockService = {
  async list(
    actorId: string,
    workspaceId: string,
    query?: string,
  ): Promise<Result<CrmEmailSavedBlockDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'email',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const blocks = await CrmEmailSavedBlockRepository.list(workspaceId, query)
    if (!blocks.ok) return blocks
    return ok(blocks.value.map(toCrmEmailSavedBlockDTO))
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateCrmEmailSavedBlockDTO,
  ): Promise<Result<CrmEmailSavedBlockDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'email',
      action: 'CREATE',
    })
    if (!membership.ok) return membership

    const validated = validateEmailFragment(dto.fragment)
    if (!validated.ok) return err(crmEmailSavedBlockInvalid(validated.error))
    if (validated.value.hasHtml && !membership.value.isPrivileged) {
      return err(crmEmailCanvasHtmlForbidden())
    }

    const count = await CrmEmailSavedBlockRepository.count(workspaceId)
    if (!count.ok) return count
    if (count.value >= SAVED_BLOCK_LIMIT) {
      return err(crmEmailSavedBlockLimitReached(SAVED_BLOCK_LIMIT))
    }

    const created = await CrmEmailSavedBlockRepository.create({
      workspaceId,
      name: dto.name,
      category: dto.category,
      kind: validated.value.kind,
      fragment: validated.value.fragment as unknown as Prisma.InputJsonValue,
      nodeCount: validated.value.nodeCount,
      thumbnail: dto.thumbnail ?? null,
      createdById: actorId,
    })
    if (!created.ok) return created

    auditMutation({
      entity: 'crm_email_saved_block',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { workspaceId, kind: validated.value.kind },
    })
    logger.info('crm_email_saved_block.created', {
      component: 'CrmEmailSavedBlockService',
      workspaceId,
      kind: validated.value.kind,
      nodes: validated.value.nodeCount,
    })
    return ok(toCrmEmailSavedBlockDTO(created.value))
  },

  async update(
    actorId: string,
    workspaceId: string,
    blockId: string,
    dto: UpdateCrmEmailSavedBlockDTO,
  ): Promise<Result<CrmEmailSavedBlockDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'email',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const existing = await CrmEmailSavedBlockRepository.findById(
      blockId,
      workspaceId,
    )
    if (!existing.ok) return existing

    const updated = await CrmEmailSavedBlockRepository.update(blockId, {
      name: dto.name,
      category: dto.category,
    })
    if (!updated.ok) return updated

    auditMutation({
      entity: 'crm_email_saved_block',
      action: 'update',
      actorId,
      targetId: blockId,
      meta: { workspaceId, fields: Object.keys(dto) },
    })
    return ok(toCrmEmailSavedBlockDTO(updated.value))
  },

  async remove(
    actorId: string,
    workspaceId: string,
    blockId: string,
  ): Promise<Result<void>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'email',
      action: 'DELETE',
    })
    if (!membership.ok) return membership

    const existing = await CrmEmailSavedBlockRepository.findById(
      blockId,
      workspaceId,
    )
    if (!existing.ok) return existing

    const removed = await CrmEmailSavedBlockRepository.delete(blockId)
    if (!removed.ok) return removed

    auditMutation({
      entity: 'crm_email_saved_block',
      action: 'delete',
      actorId,
      targetId: blockId,
      meta: { workspaceId },
    })
    return ok(undefined)
  },
}
