import { auditMutation } from '@/lib/axiom/audit'
import { validationError } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import {
  toWhatsAppSettingsDTO,
  WHATSAPP_SETTINGS_DEFAULTS,
} from '@/src/mappers/whatsapp-settings.mapper'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppSettingsRepository } from '@/src/repositories/whatsapp-settings.repository'
import type { UpdateWhatsAppSettingsDTO } from '@/src/schemas/whatsapp-settings.schema'
import type { WhatsAppSettingsDTO } from '@/types/whatsapp-settings'
import { assertModulePrivileged } from './authz'

export const WhatsAppSettingsService = {
  /** Configurações de atendimento (OWNER/ADMIN). Sem linha salva, devolve
   * os padrões. */
  async get(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppSettingsDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged

    const row = await WhatsAppSettingsRepository.findByWorkspace(workspaceId)
    if (!row.ok) return row
    return ok(toWhatsAppSettingsDTO(workspaceId, row.value))
  },

  async update(
    actorId: string,
    workspaceId: string,
    dto: UpdateWhatsAppSettingsDTO,
  ): Promise<Result<WhatsAppSettingsDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged

    const existing =
      await WhatsAppSettingsRepository.findByWorkspace(workspaceId)
    if (!existing.ok) return existing
    const current = toWhatsAppSettingsDTO(workspaceId, existing.value)

    // Destinatários e supervisor precisam ser membros do workspace.
    const referencedIds = [
      ...(dto.sentimentAlertRecipientIds ?? []),
      ...(dto.sentimentAlertAssignToId ? [dto.sentimentAlertAssignToId] : []),
    ]
    if (referencedIds.length > 0) {
      const members =
        await MembershipRepository.listWithUserByWorkspace(workspaceId)
      if (!members.ok) return members
      const memberIds = new Set(members.value.map((m) => m.userId))
      if (referencedIds.some((id) => !memberIds.has(id))) {
        return err(
          validationError(
            'Selecione apenas membros deste workspace para o alerta de sentimento',
          ),
        )
      }
    }

    const closeStatusMinSelections =
      dto.closeStatusMinSelections ?? current.closeStatusMinSelections
    const closeStatusMaxSelections =
      dto.closeStatusMaxSelections ?? current.closeStatusMaxSelections
    if (closeStatusMinSelections > closeStatusMaxSelections) {
      return err(
        validationError(
          'O mínimo de status de fechamento não pode ser maior que o máximo',
        ),
      )
    }

    const saved = await WhatsAppSettingsRepository.upsert(workspaceId, {
      autoCloseAfterHours:
        dto.autoCloseAfterHours ?? current.autoCloseAfterHours,
      sentimentAlertEnabled:
        dto.sentimentAlertEnabled ?? current.sentimentAlertEnabled,
      sentimentAlertThreshold:
        dto.sentimentAlertThreshold ?? current.sentimentAlertThreshold,
      sentimentAlertNotifyInApp:
        dto.sentimentAlertNotifyInApp ?? current.sentimentAlertNotifyInApp,
      sentimentAlertNotifyEmail:
        dto.sentimentAlertNotifyEmail ?? current.sentimentAlertNotifyEmail,
      sentimentAlertRecipientIds: dto.sentimentAlertRecipientIds
        ? Array.from(new Set(dto.sentimentAlertRecipientIds))
        : current.sentimentAlertRecipientIds,
      sentimentAlertAssignToId:
        dto.sentimentAlertAssignToId === undefined
          ? current.sentimentAlertAssignToId
          : dto.sentimentAlertAssignToId,
      sentimentAlertCooldownHours:
        dto.sentimentAlertCooldownHours ?? current.sentimentAlertCooldownHours,
      callRecordingEnabled:
        dto.callRecordingEnabled ?? current.callRecordingEnabled,
      // Stored only when the admin wrote one; the mapper fills the default.
      callRecordingNotice:
        dto.callRecordingNotice === undefined
          ? (existing.value?.callRecordingNotice ?? null)
          : dto.callRecordingNotice || null,
      callRecordingRetentionDays:
        dto.callRecordingRetentionDays ?? current.callRecordingRetentionDays,
      callTranscriptionEnabled:
        dto.callTranscriptionEnabled ?? current.callTranscriptionEnabled,
      closeStatusMinSelections,
      closeStatusMaxSelections,
    })
    if (!saved.ok) return saved

    auditMutation({
      entity: 'whatsapp_settings',
      action: existing.value ? 'update' : 'create',
      actorId,
      targetId: saved.value.id,
      meta: {
        workspaceId,
        autoCloseAfterHours: saved.value.autoCloseAfterHours,
        sentimentAlertEnabled: saved.value.sentimentAlertEnabled,
        sentimentAlertNotifyEmail: saved.value.sentimentAlertNotifyEmail,
        sentimentAlertRecipients: saved.value.sentimentAlertRecipientIds.length,
        callRecordingEnabled: saved.value.callRecordingEnabled,
        callRecordingRetentionDays: saved.value.callRecordingRetentionDays,
        callTranscriptionEnabled: saved.value.callTranscriptionEnabled,
        closeStatusMinSelections: saved.value.closeStatusMinSelections,
        closeStatusMaxSelections: saved.value.closeStatusMaxSelections,
      },
    })

    return ok(toWhatsAppSettingsDTO(workspaceId, saved.value))
  },

  /**
   * Janelas de fechamento automático, para o job (sistema): workspaces com
   * configuração salva e ligada, mais o padrão para quem nunca salvou.
   */
  async listAutoCloseWindows(): Promise<
    Result<{
      configured: { workspaceId: string; hours: number }[]
      /** Workspaces com linha salva (inclusive os desligados). */
      configuredWorkspaceIds: string[]
      defaultHours: number
    }>
  > {
    const rows = await WhatsAppSettingsRepository.listAll()
    if (!rows.ok) return rows
    return ok({
      configured: rows.value
        .filter((row) => row.autoCloseAfterHours > 0)
        .map((row) => ({
          workspaceId: row.workspaceId,
          hours: row.autoCloseAfterHours,
        })),
      configuredWorkspaceIds: rows.value.map((row) => row.workspaceId),
      defaultHours: WHATSAPP_SETTINGS_DEFAULTS.autoCloseAfterHours,
    })
  },
  /** Configuração efetiva (linha salva ou padrões) — uso de sistema. */
  async getEffective(
    workspaceId: string,
  ): Promise<Result<WhatsAppSettingsDTO>> {
    const row = await WhatsAppSettingsRepository.findByWorkspace(workspaceId)
    if (!row.ok) return row
    return ok(toWhatsAppSettingsDTO(workspaceId, row.value))
  },
}
