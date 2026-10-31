import { auditMutation } from '@/lib/axiom/audit'
import { baseEmailUrl } from '@/lib/base-email-url'
import { validationError } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import { generateWidgetKey } from '@/src/lib/whatsapp/widget'
import {
  toWhatsAppWidgetSettingsDTO,
  WHATSAPP_WIDGET_DEFAULTS,
} from '@/src/mappers/whatsapp-widget.mapper'
import { WhatsAppWidgetSettingsRepository } from '@/src/repositories/whatsapp-widget.repository'
import type { UpdateWhatsAppWidgetSettingsDTO } from '@/src/schemas/whatsapp-widget.schema'
import type { WhatsAppWidgetSettingsDTO } from '@/types/whatsapp-widget'
import { assertModulePrivileged } from './authz'

/**
 * Admin side of the site chat widget (E1): switch, key, allowed origins,
 * look, pre-chat, offline notice, team and extras. OWNER/ADMIN only; the
 * public endpoints live in `WhatsAppWidgetPublicService`.
 */
export const WhatsAppWidgetService = {
  /** Settings (defaults and no key until the first save). */
  async get(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppWidgetSettingsDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged

    const row = await WhatsAppWidgetSettingsRepository.findByWorkspace(workspaceId)
    if (!row.ok) return row
    return ok(toWhatsAppWidgetSettingsDTO(workspaceId, row.value, baseEmailUrl))
  },

  async update(
    actorId: string,
    workspaceId: string,
    dto: UpdateWhatsAppWidgetSettingsDTO,
  ): Promise<Result<WhatsAppWidgetSettingsDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged

    const existing =
      await WhatsAppWidgetSettingsRepository.findByWorkspace(workspaceId)
    if (!existing.ok) return existing

    const enabled = dto.enabled ?? existing.value?.enabled ?? false
    const origins =
      dto.allowedOrigins ??
      existing.value?.allowedOrigins ??
      WHATSAPP_WIDGET_DEFAULTS.allowedOrigins
    if (enabled && origins.length === 0) {
      return err(
        validationError('Informe ao menos um site autorizado para ligar o chat'),
      )
    }

    if (dto.teamId) {
      const team = await WhatsAppWidgetSettingsRepository.teamExists(
        workspaceId,
        dto.teamId,
      )
      if (!team.ok) return team
      if (!team.value) {
        return err(validationError('Selecione uma equipe deste workspace'))
      }
    }

    // The virtual connection the chats hang on exists as soon as the widget
    // is switched on for the first time.
    let connectionId = existing.value?.connectionId ?? null
    if (enabled && !connectionId) {
      const connection = await WhatsAppWidgetSettingsRepository.ensureConnection(
        workspaceId,
        actorId,
      )
      if (!connection.ok) return connection
      connectionId = connection.value.id
    }

    const saved = await WhatsAppWidgetSettingsRepository.upsert(
      workspaceId,
      existing.value?.publicKey ?? generateWidgetKey(),
      {
        ...dto,
        ...(connectionId ? { connectionId } : {}),
      },
    )
    if (!saved.ok) return saved

    auditMutation({
      entity: 'whatsapp_widget_settings',
      action: 'update',
      actorId,
      targetId: saved.value.id,
      meta: { workspaceId, ...dto },
    })
    return ok(toWhatsAppWidgetSettingsDTO(workspaceId, saved.value, baseEmailUrl))
  },

  /** New public key: snippets already pasted on sites stop working. */
  async rotateKey(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppWidgetSettingsDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged

    const existing =
      await WhatsAppWidgetSettingsRepository.findByWorkspace(workspaceId)
    if (!existing.ok) return existing
    if (!existing.value) {
      return err(validationError('Salve as configurações antes de trocar a chave'))
    }

    const rotated = await WhatsAppWidgetSettingsRepository.rotateKey(
      workspaceId,
      generateWidgetKey(),
    )
    if (!rotated.ok) return rotated

    auditMutation({
      entity: 'whatsapp_widget_settings',
      action: 'update',
      actorId,
      targetId: rotated.value.id,
      meta: { workspaceId, rotatedKey: true },
    })
    return ok(
      toWhatsAppWidgetSettingsDTO(workspaceId, rotated.value, baseEmailUrl),
    )
  },
}
