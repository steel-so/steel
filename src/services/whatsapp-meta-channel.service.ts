import { auditMutation } from '@/lib/axiom/audit'
import { ok, type Result } from '@/src/lib/result'
import {
  toMetaChannelConnectionDTO,
  toMetaChannelSettingsDTO,
} from '@/src/mappers/whatsapp-meta-channel.mapper'
import { WhatsAppMetaChannelRepository } from '@/src/repositories/whatsapp-meta-channel.repository'
import type { UpdateMetaChannelSettingsDTO } from '@/src/schemas/whatsapp-meta-channel.schema'
import type {
  MetaChannelConnectionDTO,
  WhatsAppMetaChannelSettingsDTO,
} from '@/types/whatsapp-meta-channel'
import { assertModuleMember, assertModulePrivileged } from './authz'

const COMMUNICATION = 'COMMUNICATION' as const

export const WhatsAppMetaChannelService = {
  async getSettings(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppMetaChannelSettingsDTO>> {
    const member = await assertModuleMember(actorId, workspaceId, COMMUNICATION)
    if (!member.ok) return member
    const row = await WhatsAppMetaChannelRepository.findSettings(workspaceId)
    if (!row.ok) return row
    return ok(toMetaChannelSettingsDTO(workspaceId, row.value))
  },

  async updateSettings(
    actorId: string,
    workspaceId: string,
    dto: UpdateMetaChannelSettingsDTO,
  ): Promise<Result<WhatsAppMetaChannelSettingsDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      COMMUNICATION,
    )
    if (!privileged.ok) return privileged

    const saved = await WhatsAppMetaChannelRepository.upsertSettings(
      workspaceId,
      dto,
    )
    if (!saved.ok) return saved

    auditMutation({
      entity: 'whatsapp_settings',
      action: 'update',
      actorId,
      targetId: workspaceId,
      meta: { scope: 'meta_channels', changed: Object.keys(dto) },
    })
    return ok(toMetaChannelSettingsDTO(workspaceId, saved.value))
  },

  /** WhatsApp numbers connected through Coexistence. */
  async listConnections(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<MetaChannelConnectionDTO[]>> {
    const member = await assertModuleMember(actorId, workspaceId, COMMUNICATION)
    if (!member.ok) return member
    const rows =
      await WhatsAppMetaChannelRepository.listCoexistenceConnections(
        workspaceId,
      )
    if (!rows.ok) return rows
    return ok(rows.value.map(toMetaChannelConnectionDTO))
  },
}
