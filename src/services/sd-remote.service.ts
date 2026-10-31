import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { sdRemoteDisabled, sdRemoteEndpointNotFound } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import {
  buildRemoteLink,
  SD_REMOTE_PROVIDERS,
} from '@/src/lib/servicedesk/remote-access'
import {
  toSdRemoteEndpointDTO,
  toSdRemoteSessionDTO,
  toSdRemoteSettingsDTO,
} from '@/src/mappers/sd-remote.mapper'
import { SdConfigItemRepository } from '@/src/repositories/sd-config-item.repository'
import { SdRemoteRepository } from '@/src/repositories/sd-remote.repository'
import { SdTicketRepository } from '@/src/repositories/sd-ticket.repository'
import type {
  ConnectSdRemoteDTO,
  ListSdRemoteSessionsDTO,
  UpdateSdRemoteSettingsDTO,
  UpsertSdRemoteEndpointDTO,
} from '@/src/schemas/sd-remote.schema'
import type {
  SdRemoteConnectDTO,
  SdRemoteEndpointDTO,
  SdRemoteSessionDTO,
  SdRemoteSettingsDTO,
} from '@/types/sd-remote'
import { SdAccess } from './sd-access'
import { sdAdminMutation } from './sd-config-support'
import { recordSdTicketEvent } from './sd-ticket-event-recorder'

async function loadSettings(
  workspaceId: string,
): Promise<Result<SdRemoteSettingsDTO>> {
  const row = await SdRemoteRepository.findSettings(workspaceId)
  if (!row.ok) return row
  return ok(toSdRemoteSettingsDTO(row.value))
}

export const SdRemoteService = {
  /** Sem autorização: uso interno (ingestão do inventário). */
  async saveInventoryEndpoints(
    workspaceId: string,
    configItemId: string,
    ids: { rustdesk?: string | null; anydesk?: string | null },
  ): Promise<Result<number>> {
    const wanted = [
      ['RUSTDESK', ids.rustdesk],
      ['ANYDESK', ids.anydesk],
    ] as const
    let saved = 0
    for (const [provider, remoteId] of wanted) {
      if (!remoteId) continue
      const current = await SdRemoteRepository.findEndpoint(
        workspaceId,
        configItemId,
        provider,
      )
      // O que um técnico digitou à mão vale mais que o relatório do agente.
      if (current.ok && current.value.source === 'MANUAL') continue
      if (current.ok && current.value.remoteId === remoteId) continue
      const result = await SdRemoteRepository.upsertEndpoint({
        workspaceId,
        configItemId,
        provider,
        remoteId,
        source: 'INVENTORY',
      })
      if (!result.ok) return result
      saved += 1
    }
    return ok(saved)
  },

  async getSettings(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<SdRemoteSettingsDTO>> {
    const ctx = await SdAccess.requireAgent(actorId, workspaceId)
    if (!ctx.ok) return ctx
    return loadSettings(workspaceId)
  },

  async updateSettings(
    actorId: string,
    workspaceId: string,
    dto: UpdateSdRemoteSettingsDTO,
  ): Promise<Result<SdRemoteSettingsDTO>> {
    return sdAdminMutation({
      actorId,
      workspaceId,
      entity: 'sd_remote_settings',
      action: 'update',
      targetId: workspaceId,
      meta: { fields: Object.keys(dto) },
      run: async () => {
        const saved = await SdRemoteRepository.upsertSettings(workspaceId, dto)
        if (!saved.ok) return saved
        return ok(toSdRemoteSettingsDTO(saved.value))
      },
    })
  },

  async listEndpoints(
    actorId: string,
    workspaceId: string,
    configItemId: string,
  ): Promise<Result<SdRemoteEndpointDTO[]>> {
    const ctx = await SdAccess.requireAgent(actorId, workspaceId)
    if (!ctx.ok) return ctx
    const item = await SdConfigItemRepository.findById(
      configItemId,
      workspaceId,
    )
    if (!item.ok) return item
    const rows = await SdRemoteRepository.listEndpoints(
      workspaceId,
      configItemId,
    )
    if (!rows.ok) return rows
    return ok(rows.value.map(toSdRemoteEndpointDTO))
  },

  async upsertEndpoint(
    actorId: string,
    workspaceId: string,
    dto: UpsertSdRemoteEndpointDTO,
  ): Promise<Result<SdRemoteEndpointDTO>> {
    const ctx = await SdAccess.requireAgent(actorId, workspaceId)
    if (!ctx.ok) return ctx
    const item = await SdConfigItemRepository.findById(
      dto.configItemId,
      workspaceId,
    )
    if (!item.ok) return item
    const saved = await SdRemoteRepository.upsertEndpoint({
      workspaceId,
      configItemId: dto.configItemId,
      provider: dto.provider,
      remoteId: dto.remoteId,
      source: 'MANUAL',
    })
    auditMutation({
      entity: 'sd_remote_endpoint',
      action: 'update',
      actorId,
      targetId: saved.ok ? saved.value.id : null,
      meta: {
        workspaceId,
        configItemId: dto.configItemId,
        provider: dto.provider,
      },
      ...(saved.ok
        ? {}
        : { outcome: 'failure' as const, reason: saved.error.code }),
    })
    if (!saved.ok) return saved
    return ok(toSdRemoteEndpointDTO(saved.value))
  },

  async deleteEndpoint(
    actorId: string,
    workspaceId: string,
    endpointId: string,
  ): Promise<Result<{ id: string }>> {
    const ctx = await SdAccess.requireAgent(actorId, workspaceId)
    if (!ctx.ok) return ctx
    const found = await SdRemoteRepository.findEndpointById(
      workspaceId,
      endpointId,
    )
    if (!found.ok) return found
    const removed = await SdRemoteRepository.deleteEndpoint(endpointId)
    auditMutation({
      entity: 'sd_remote_endpoint',
      action: 'delete',
      actorId,
      targetId: endpointId,
      meta: { workspaceId, configItemId: found.value.configItemId },
      ...(removed.ok
        ? {}
        : { outcome: 'failure' as const, reason: removed.error.code }),
    })
    if (!removed.ok) return removed
    return ok({ id: endpointId })
  },

  /**
   * "Conectar": resolve o link do provedor escolhido pelo workspace para o
   * ativo, grava a sessão e — quando vem de um chamado — o evento no
   * histórico do chamado. O link só carrega o ID público da máquina.
   */
  async connect(
    actorId: string,
    workspaceId: string,
    dto: ConnectSdRemoteDTO,
  ): Promise<Result<SdRemoteConnectDTO>> {
    const ctx = await SdAccess.requireAgent(actorId, workspaceId)
    if (!ctx.ok) return ctx

    const settings = await SdRemoteRepository.findSettings(workspaceId)
    if (!settings.ok) return settings
    const config = toSdRemoteSettingsDTO(settings.value)
    if (!config.enabled) return err(sdRemoteDisabled())

    const item = await SdConfigItemRepository.findById(
      dto.configItemId,
      workspaceId,
    )
    if (!item.ok) return item

    let ticketNumber: number | null = null
    if (dto.ticketId) {
      const ticket = await SdTicketRepository.findById(
        dto.ticketId,
        workspaceId,
      )
      if (!ticket.ok) return ticket
      ticketNumber = ticket.value.number
    }

    const endpoint = await SdRemoteRepository.findEndpoint(
      workspaceId,
      dto.configItemId,
      config.provider,
    )
    if (!endpoint.ok) {
      return err(
        endpoint.error.code === 'SD_REMOTE_ENDPOINT_NOT_FOUND'
          ? sdRemoteEndpointNotFound()
          : endpoint.error,
      )
    }

    const session = await SdRemoteRepository.createSession({
      workspaceId,
      configItemId: dto.configItemId,
      ticketId: dto.ticketId ?? null,
      userId: actorId,
      provider: config.provider,
      remoteId: endpoint.value.remoteId,
    })
    if (!session.ok) return session

    auditMutation({
      entity: 'sd_remote_session',
      action: 'connect',
      actorId,
      targetId: session.value.id,
      meta: {
        workspaceId,
        configItemId: dto.configItemId,
        ticketId: dto.ticketId ?? null,
        provider: config.provider,
      },
    })

    if (dto.ticketId) {
      await recordSdTicketEvent({
        workspaceId,
        ticketId: dto.ticketId,
        actorKind: 'AGENT',
        actorUserId: actorId,
        action: 'remote.session_started',
        toValue: { id: item.value.id, label: item.value.name },
        meta: {
          provider: config.provider,
          providerLabel: SD_REMOTE_PROVIDERS[config.provider].label,
          sessionId: session.value.id,
          ticketNumber,
        },
      })
    }

    logger.info('servicedesk.remote.session_started', {
      workspaceId,
      configItemId: dto.configItemId,
      provider: config.provider,
    })

    return ok({
      sessionId: session.value.id,
      provider: config.provider,
      remoteId: endpoint.value.remoteId,
      link: buildRemoteLink(
        config.provider,
        endpoint.value.remoteId,
        config.linkTemplate,
      ),
    })
  },

  async listSessions(
    actorId: string,
    workspaceId: string,
    query: ListSdRemoteSessionsDTO,
  ): Promise<Result<SdRemoteSessionDTO[]>> {
    const ctx = await SdAccess.requireAgent(actorId, workspaceId)
    if (!ctx.ok) return ctx
    const item = await SdConfigItemRepository.findById(
      query.configItemId,
      workspaceId,
    )
    if (!item.ok) return item
    const rows = await SdRemoteRepository.listSessions(
      workspaceId,
      query.configItemId,
      query.limit,
    )
    if (!rows.ok) return rows
    return ok(rows.value.map(toSdRemoteSessionDTO))
  },
}
