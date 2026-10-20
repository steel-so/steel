import type { WhatsAppCloseOutcome } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import {
  whatsappCloseStatusLimitReached,
  whatsappCloseStatusNotFound,
  whatsappCloseStatusSelectionInvalid,
} from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import { toWhatsAppCloseStatusDTO } from '@/src/mappers/whatsapp-close-status.mapper'
import { WhatsAppCloseStatusRepository } from '@/src/repositories/whatsapp-close-status.repository'
import {
  type CreateWhatsAppCloseStatusDTO,
  type UpdateWhatsAppCloseStatusDTO,
  WHATSAPP_CLOSE_STATUS_MAX,
} from '@/src/schemas/whatsapp-close-status.schema'
import type {
  WhatsAppCloseStatusDTO,
  WhatsAppCloseStatusOptionsDTO,
} from '@/types/whatsapp-close-status'
import { assertModuleMember, assertModulePrivileged } from './authz'
import { WhatsAppSettingsService } from './whatsapp-settings.service'

/** Classification picked when closing a conversation (snapshot). */
export interface WhatsAppCloseClassification {
  outcome: WhatsAppCloseOutcome
  statusIds: string[]
  labels: string[]
}

export const WhatsAppCloseStatusService = {
  /** Options shown in the close dialog + how many the agent picks. */
  async listOptions(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppCloseStatusOptionsDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'VIEW' },
    )
    if (!membership.ok) return membership

    const [statuses, settings] = await Promise.all([
      WhatsAppCloseStatusRepository.listActive(workspaceId),
      WhatsAppSettingsService.getEffective(workspaceId),
    ])
    if (!statuses.ok) return statuses
    if (!settings.ok) return settings

    return ok({
      statuses: statuses.value.map(toWhatsAppCloseStatusDTO),
      minSelections: settings.value.closeStatusMinSelections,
      maxSelections: settings.value.closeStatusMaxSelections,
    })
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateWhatsAppCloseStatusDTO,
  ): Promise<Result<WhatsAppCloseStatusDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged

    const existing = await WhatsAppCloseStatusRepository.listActive(workspaceId)
    if (!existing.ok) return existing
    if (existing.value.length >= WHATSAPP_CLOSE_STATUS_MAX) {
      return err(whatsappCloseStatusLimitReached(WHATSAPP_CLOSE_STATUS_MAX))
    }

    const position =
      existing.value.reduce(
        (max, status) => Math.max(max, status.position),
        -1,
      ) + 1
    const created = await WhatsAppCloseStatusRepository.create({
      workspaceId,
      label: dto.label,
      outcome: dto.outcome,
      position,
    })
    if (!created.ok) return created

    auditMutation({
      entity: 'whatsapp_close_status',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { workspaceId, outcome: created.value.outcome },
    })
    return ok(toWhatsAppCloseStatusDTO(created.value))
  },

  async update(
    actorId: string,
    workspaceId: string,
    id: string,
    dto: UpdateWhatsAppCloseStatusDTO,
  ): Promise<Result<WhatsAppCloseStatusDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged

    const existing = await WhatsAppCloseStatusRepository.findActiveById(
      id,
      workspaceId,
    )
    if (!existing.ok) return existing
    if (!existing.value) return err(whatsappCloseStatusNotFound())

    const updated = await WhatsAppCloseStatusRepository.update(id, dto)
    if (!updated.ok) return updated

    auditMutation({
      entity: 'whatsapp_close_status',
      action: 'update',
      actorId,
      targetId: id,
      meta: { workspaceId, fields: Object.keys(dto) },
    })
    return ok(toWhatsAppCloseStatusDTO(updated.value))
  },

  /** Archives the status: it leaves the close dialog, the history keeps it. */
  async archive(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<{ id: string }>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged

    const existing = await WhatsAppCloseStatusRepository.findActiveById(
      id,
      workspaceId,
    )
    if (!existing.ok) return existing
    if (!existing.value) return err(whatsappCloseStatusNotFound())

    const archived = await WhatsAppCloseStatusRepository.update(id, {
      archivedAt: new Date(),
    })
    if (!archived.ok) return archived

    auditMutation({
      entity: 'whatsapp_close_status',
      action: 'archive',
      actorId,
      targetId: id,
      meta: { workspaceId },
    })
    return ok({ id })
  },

  /**
   * Validates the statuses picked on close against the workspace rules
   * (active statuses, min/max count) and resolves the outcome: FAILURE when
   * any picked status is a failure. `null` = no classification (none picked
   * and none required, or the workspace has no statuses).
   */
  async resolveClassification(
    workspaceId: string,
    statusIds: string[],
  ): Promise<Result<WhatsAppCloseClassification | null>> {
    const unique = Array.from(new Set(statusIds))
    const statuses = await WhatsAppCloseStatusRepository.listActive(workspaceId)
    if (!statuses.ok) return statuses

    if (statuses.value.length === 0) {
      if (unique.length > 0) {
        return err(
          whatsappCloseStatusSelectionInvalid(
            'Este workspace não tem status de fechamento cadastrados',
          ),
        )
      }
      return ok(null)
    }

    const settings = await WhatsAppSettingsService.getEffective(workspaceId)
    if (!settings.ok) return settings
    const { closeStatusMinSelections: min, closeStatusMaxSelections: max } =
      settings.value
    if (unique.length < min) {
      return err(
        whatsappCloseStatusSelectionInvalid(
          `Escolha pelo menos ${min} status para fechar a conversa`,
        ),
      )
    }
    if (unique.length > max) {
      return err(
        whatsappCloseStatusSelectionInvalid(
          `Escolha no máximo ${max} status para fechar a conversa`,
        ),
      )
    }
    if (unique.length === 0) return ok(null)

    const byId = new Map(statuses.value.map((status) => [status.id, status]))
    const picked = unique.map((id) => byId.get(id))
    if (picked.some((status) => !status)) {
      return err(
        whatsappCloseStatusSelectionInvalid(
          'Um dos status escolhidos não existe mais — recarregue e tente de novo',
        ),
      )
    }
    const ordered = picked
      .filter((status) => status !== undefined)
      .sort((a, b) => a.position - b.position)

    return ok({
      outcome: ordered.some((status) => status.outcome === 'FAILURE')
        ? 'FAILURE'
        : 'SUCCESS',
      statusIds: ordered.map((status) => status.id),
      labels: ordered.map((status) => status.label),
    })
  },
}
