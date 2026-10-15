import type { WhatsAppConnection } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { badRequest, whatsappConnectionNotFound } from '@/src/errors'
import {
  decryptConnectionSecret,
  encryptConnectionSecret,
} from '@/src/lib/crypto'
import { err, ok, type Result } from '@/src/lib/result'
import { createMetaClient } from '@/src/lib/whatsapp/meta-client'
import { createZapiClient } from '@/src/lib/whatsapp/zapi-client'
import { toSdWhatsappConnectionDTO } from '@/src/mappers/sd-whatsapp.mapper'
import { SdSettingsRepository } from '@/src/repositories/sd-settings.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import type {
  CreateWhatsAppConnectionDTO,
  UpdateWhatsAppConnectionDTO,
} from '@/src/schemas/whatsapp-connection.schema'
import type {
  SdWhatsappConnectionDTO,
  SdWhatsappConnectionTestDTO,
  SdWhatsappQrCodeDTO,
} from '@/types/sd-whatsapp'
import { SdAccess } from './sd-access'
import { WhatsAppConnectionHealthService } from './whatsapp-connection-health.service'

/**
 * Conexões do WhatsApp do ServiceDesk (`WhatsAppConnection.module =
 * SERVICE_DESK`): cadastro pelos admins do módulo (`SdAccess.requireAdmin`),
 * sem depender do módulo Comunicação. Credenciais cifradas como no zap.
 * A primeira conexão criada vira a ativa (`SdSettings.whatsappConnectionId`).
 */

const MODULE = 'SERVICE_DESK' as const

function audit(
  action: 'create' | 'update' | 'delete' | 'test',
  actorId: string,
  workspaceId: string,
  targetId: string | null,
  extra: {
    outcome?: 'failure'
    reason?: string
    meta?: Record<string, unknown>
  } = {},
) {
  auditMutation({
    entity: 'whatsapp_connection',
    action,
    actorId,
    targetId,
    ...(extra.outcome ? { outcome: extra.outcome, reason: extra.reason } : {}),
    meta: { workspaceId, module: MODULE, ...(extra.meta ?? {}) },
  })
}

async function activeId(workspaceId: string): Promise<Result<string | null>> {
  const settings = await SdSettingsRepository.getOrCreate(workspaceId)
  if (!settings.ok) return settings
  return ok(settings.value.whatsappConnectionId)
}

async function loadOwned(
  workspaceId: string,
  id: string,
): Promise<Result<WhatsAppConnection>> {
  const found = await WhatsAppConnectionRepository.findById(
    id,
    workspaceId,
    MODULE,
  )
  if (!found.ok) return found
  if (!found.value) return err(whatsappConnectionNotFound())
  return ok(found.value)
}

async function zapiClient(connection: WhatsAppConnection) {
  if (!connection.zapiInstanceId || !connection.encryptedZapiToken) {
    return null
  }
  const token = await decryptConnectionSecret(connection.encryptedZapiToken)
  const clientToken = connection.encryptedZapiClientToken
    ? await decryptConnectionSecret(connection.encryptedZapiClientToken)
    : undefined
  return createZapiClient({
    instanceId: connection.zapiInstanceId,
    token,
    clientToken,
  })
}

export const SdWhatsappConnectionService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<SdWhatsappConnectionDTO[]>> {
    const ctx = await SdAccess.requireAdmin(actorId, workspaceId)
    if (!ctx.ok) return ctx
    const [rows, active] = await Promise.all([
      WhatsAppConnectionRepository.listByWorkspace(workspaceId, MODULE),
      activeId(workspaceId),
    ])
    if (!rows.ok) return rows
    if (!active.ok) return active
    return ok(rows.value.map((c) => toSdWhatsappConnectionDTO(c, active.value)))
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateWhatsAppConnectionDTO,
  ): Promise<Result<SdWhatsappConnectionDTO>> {
    const ctx = await SdAccess.requireAdmin(actorId, workspaceId)
    if (!ctx.ok) {
      audit('create', actorId, workspaceId, null, {
        outcome: 'failure',
        reason: ctx.error.code,
      })
      return ctx
    }
    const base = {
      workspaceId,
      module: MODULE,
      provider: dto.provider,
      label: dto.label,
      phoneNumber: dto.phoneNumber,
      createdById: actorId,
    }
    const data =
      dto.provider === 'ZAPI'
        ? {
            ...base,
            zapiInstanceId: dto.zapiInstanceId,
            encryptedZapiToken: await encryptConnectionSecret(dto.zapiToken),
            encryptedZapiClientToken: dto.zapiClientToken
              ? await encryptConnectionSecret(dto.zapiClientToken)
              : null,
          }
        : {
            ...base,
            metaPhoneNumberId: dto.metaPhoneNumberId,
            metaWabaId: dto.metaWabaId,
            encryptedMetaAccessToken: await encryptConnectionSecret(
              dto.metaAccessToken,
            ),
          }
    const created = await WhatsAppConnectionRepository.create(data)
    if (!created.ok) {
      audit('create', actorId, workspaceId, null, {
        outcome: 'failure',
        reason: created.error.code,
      })
      return created
    }

    const current = await activeId(workspaceId)
    if (!current.ok) return current
    // Primeira conexão do módulo: já entra como a ativa do ServiceDesk.
    let activeConnectionId = current.value
    if (!activeConnectionId) {
      const updated = await SdSettingsRepository.update(workspaceId, {
        whatsappConnectionId: created.value.id,
        updatedById: actorId,
      })
      if (!updated.ok) return updated
      activeConnectionId = created.value.id
    }
    audit('create', actorId, workspaceId, created.value.id, {
      meta: { provider: dto.provider },
    })
    return ok(toSdWhatsappConnectionDTO(created.value, activeConnectionId))
  },

  async update(
    actorId: string,
    workspaceId: string,
    id: string,
    dto: UpdateWhatsAppConnectionDTO,
  ): Promise<Result<SdWhatsappConnectionDTO>> {
    const ctx = await SdAccess.requireAdmin(actorId, workspaceId)
    if (!ctx.ok) return ctx
    const existing = await loadOwned(workspaceId, id)
    if (!existing.ok) return existing

    const data: Record<string, unknown> = {}
    if (dto.label !== undefined) data.label = dto.label
    if (dto.zapiToken !== undefined) {
      data.encryptedZapiToken = await encryptConnectionSecret(dto.zapiToken)
    }
    if (dto.zapiClientToken !== undefined) {
      data.encryptedZapiClientToken = await encryptConnectionSecret(
        dto.zapiClientToken,
      )
    }
    if (dto.metaAccessToken !== undefined) {
      data.encryptedMetaAccessToken = await encryptConnectionSecret(
        dto.metaAccessToken,
      )
    }
    const updated = await WhatsAppConnectionRepository.update(id, data)
    if (!updated.ok) return updated
    const active = await activeId(workspaceId)
    if (!active.ok) return active
    audit('update', actorId, workspaceId, id, {
      meta: { fields: Object.keys(dto) },
    })
    return ok(toSdWhatsappConnectionDTO(updated.value, active.value))
  },

  /** Remove a conexão; se era a ativa, o ServiceDesk fica sem WhatsApp. */
  async remove(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<void>> {
    const ctx = await SdAccess.requireAdmin(actorId, workspaceId)
    if (!ctx.ok) return ctx
    const existing = await loadOwned(workspaceId, id)
    if (!existing.ok) return existing
    const active = await activeId(workspaceId)
    if (!active.ok) return active
    if (active.value === id) {
      const cleared = await SdSettingsRepository.update(workspaceId, {
        whatsappConnectionId: null,
        updatedById: actorId,
      })
      if (!cleared.ok) return cleared
    }
    const removed = await WhatsAppConnectionRepository.delete(id)
    if (!removed.ok) return removed
    audit('delete', actorId, workspaceId, id)
    return ok(undefined)
  },

  /** Testa as credenciais no provedor e atualiza o status da conexão. */
  async test(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<SdWhatsappConnectionTestDTO>> {
    const ctx = await SdAccess.requireAdmin(actorId, workspaceId)
    if (!ctx.ok) return ctx
    const existing = await loadOwned(workspaceId, id)
    if (!existing.ok) return existing
    const connection = existing.value

    let connected = false
    let failed = false
    let error: string | null = null
    try {
      if (connection.provider === 'ZAPI') {
        const client = await zapiClient(connection)
        if (!client)
          throw new Error('Conexão Z-API sem credenciais configuradas')
        connected = (await client.getConnectionStatus()).connected
      } else {
        if (
          !connection.metaPhoneNumberId ||
          !connection.metaWabaId ||
          !connection.encryptedMetaAccessToken
        ) {
          throw new Error('Conexão Meta sem credenciais configuradas')
        }
        const client = createMetaClient({
          phoneNumberId: connection.metaPhoneNumberId,
          wabaId: connection.metaWabaId,
          accessToken: await decryptConnectionSecret(
            connection.encryptedMetaAccessToken,
          ),
        })
        const check = await client.getConnectionStatus()
        connected = check.connected
        failed = check.failed ?? false
        error = check.error ?? null
      }
      if (!connected)
        error ??= 'O provedor informou que o número não está conectado'
    } catch (cause) {
      failed = true
      error =
        cause instanceof Error ? cause.message : 'Falha ao testar a conexão'
    }

    const status = connected ? 'CONNECTED' : failed ? 'ERROR' : 'DISCONNECTED'
    if (status === 'CONNECTED') {
      const updated = await WhatsAppConnectionRepository.update(id, {
        status,
        statusError: null,
      })
      if (!updated.ok) return updated
    } else {
      // Going down from CONNECTED tells the admins (once per transition).
      const down = await WhatsAppConnectionHealthService.markDown(connection, {
        status,
        error,
        source: 'test',
        actorId,
      })
      if (!down.ok) return down
    }
    audit('test', actorId, workspaceId, id, { meta: { connected } })
    logger.info('servicedesk.whatsapp.connection_tested', {
      workspaceId,
      connectionId: id,
      connected,
    })
    return ok({ connected, status, error })
  },

  /** QR code da Z-API para parear o número. */
  async qrCode(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<SdWhatsappQrCodeDTO>> {
    const ctx = await SdAccess.requireAdmin(actorId, workspaceId)
    if (!ctx.ok) return ctx
    const existing = await loadOwned(workspaceId, id)
    if (!existing.ok) return existing
    const connection = existing.value
    if (connection.provider !== 'ZAPI') {
      return err(
        badRequest('QR code está disponível apenas para conexões Z-API'),
      )
    }
    const client = await zapiClient(connection)
    if (!client) {
      return err(badRequest('Conexão Z-API sem credenciais configuradas'))
    }
    let qr: SdWhatsappQrCodeDTO
    try {
      qr = await client.getQrCode()
    } catch (cause) {
      return err(
        badRequest(
          cause instanceof Error ? cause.message : 'Falha ao obter o QR code',
        ),
      )
    }
    const status = qr.status === 'connected' ? 'CONNECTED' : 'CONNECTING'
    if (status !== connection.status) {
      await WhatsAppConnectionRepository.update(id, { status })
    }
    return ok(qr)
  },
}
