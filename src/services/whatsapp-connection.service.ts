import type { WhatsAppConnection } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { NEXT_PUBLIC_META_APP_ID } from '@/lib/env/env'
import {
  WHATSAPP_META_APP_ID,
  WHATSAPP_META_APP_SECRET,
} from '@/lib/env/server'
import {
  badRequest,
  featureNotEnabled,
  whatsappConnectionNotFound,
  whatsappProviderError,
} from '@/src/errors'
import {
  decryptConnectionSecret,
  encryptConnectionSecret,
} from '@/src/lib/crypto'
import { err, ok, type Result } from '@/src/lib/result'
import { createMetaClient } from '@/src/lib/whatsapp/meta-client'
import {
  exchangeSignupCode,
  fetchPhoneInfo,
  generateRegistrationPin,
  registerPhoneNumber,
  subscribeAppToWaba,
} from '@/src/lib/whatsapp/meta-signup'
import { createZapiClient } from '@/src/lib/whatsapp/zapi-client'
import {
  toWhatsAppConnectionCreatedDTO,
  toWhatsAppConnectionDTO,
} from '@/src/mappers/whatsapp-connection.mapper'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import type {
  CreateWhatsAppConnectionDTO,
  MetaEmbeddedSignupDTO,
  UpdateWhatsAppConnectionDTO,
} from '@/src/schemas/whatsapp-connection.schema'
import type {
  WhatsAppConnectionCreatedDTO,
  WhatsAppConnectionDTO,
} from '@/types/whatsapp-connection'
import { assertModuleMember, assertModulePrivileged } from './authz'
import { WhatsAppConnectionHealthService } from './whatsapp-connection-health.service'

/**
 * Checks a Meta number against the Graph API and persists the verdict:
 * CONNECTED, ERROR (blocked / bad token) or DISCONNECTED (not registered
 * yet), with the pt-BR reason in `statusError`.
 */
async function applyMetaStatus(
  connection: WhatsAppConnection,
  source: 'test',
  actorId: string,
): Promise<Result<WhatsAppConnection>> {
  if (
    !connection.metaPhoneNumberId ||
    !connection.metaWabaId ||
    !connection.encryptedMetaAccessToken
  ) {
    return err(badRequest('Conexão Meta sem credenciais configuradas'))
  }
  const client = createMetaClient({
    phoneNumberId: connection.metaPhoneNumberId,
    wabaId: connection.metaWabaId,
    accessToken: await decryptConnectionSecret(
      connection.encryptedMetaAccessToken,
    ),
  })
  const check = await client.getConnectionStatus()
  if (check.connected) {
    const updated = await WhatsAppConnectionRepository.update(connection.id, {
      status: 'CONNECTED',
      statusError: null,
    })
    return updated
  }
  const status = check.failed ? 'ERROR' : 'DISCONNECTED'
  const down = await WhatsAppConnectionHealthService.markDown(connection, {
    status,
    error: check.error ?? null,
    source,
    actorId,
  })
  if (!down.ok) return down
  return ok({ ...connection, status, statusError: check.error ?? null })
}

export const WhatsAppConnectionService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppConnectionDTO[]>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!membership.ok) return membership

    const result =
      await WhatsAppConnectionRepository.listByWorkspace(workspaceId)
    if (!result.ok) return result

    return ok(result.value.map(toWhatsAppConnectionDTO))
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateWhatsAppConnectionDTO,
  ): Promise<Result<WhatsAppConnectionCreatedDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) {
      auditMutation({
        entity: 'whatsapp_connection',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: privileged.error.code,
      })
      return privileged
    }

    const baseData = {
      workspaceId,
      provider: dto.provider,
      label: dto.label,
      phoneNumber: dto.phoneNumber,
      createdById: actorId,
    }

    const data =
      dto.provider === 'ZAPI'
        ? {
            ...baseData,
            zapiInstanceId: dto.zapiInstanceId,
            encryptedZapiToken: await encryptConnectionSecret(dto.zapiToken),
            encryptedZapiClientToken: dto.zapiClientToken
              ? await encryptConnectionSecret(dto.zapiClientToken)
              : null,
          }
        : {
            ...baseData,
            metaPhoneNumberId: dto.metaPhoneNumberId,
            metaWabaId: dto.metaWabaId,
            encryptedMetaAccessToken: await encryptConnectionSecret(
              dto.metaAccessToken,
            ),
          }

    const result = await WhatsAppConnectionRepository.create(data)
    if (!result.ok) {
      auditMutation({
        entity: 'whatsapp_connection',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: result.error.code,
      })
      return result
    }

    auditMutation({
      entity: 'whatsapp_connection',
      action: 'create',
      actorId,
      targetId: result.value.id,
      meta: { provider: dto.provider },
    })

    // A Meta number is verified right away; Z-API stays CONNECTING until its
    // webhook / QR flow says otherwise.
    let created = result.value
    if (dto.provider === 'META') {
      const checked = await applyMetaStatus(created, 'test', actorId)
      if (checked.ok) created = checked.value
    }

    return ok(toWhatsAppConnectionCreatedDTO(created))
  },

  /** Re-checks a Meta connection on the Graph API (button "Atualizar status"). */
  async refreshStatus(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<WhatsAppConnectionDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged

    const existing = await WhatsAppConnectionRepository.findById(
      id,
      workspaceId,
    )
    if (!existing.ok) return existing
    if (!existing.value) return err(whatsappConnectionNotFound())
    if (existing.value.provider !== 'META') {
      return err(
        badRequest('A verificação de status vale apenas para conexões Meta'),
      )
    }

    const checked = await applyMetaStatus(existing.value, 'test', actorId)
    if (!checked.ok) return checked
    auditMutation({
      entity: 'whatsapp_connection',
      action: 'update',
      actorId,
      targetId: id,
      meta: { refreshedStatus: checked.value.status },
    })
    return ok(toWhatsAppConnectionDTO(checked.value))
  },

  /**
   * Meta Embedded Signup: turns the popup result (code + ids) into a ready
   * connection. Exchanges the code, subscribes the app to the WABA, registers
   * the number with a random PIN (stored encrypted for support), reads the
   * display data and creates the connection. Tokens and PINs are never logged.
   */
  async connectViaEmbeddedSignup(
    actorId: string,
    workspaceId: string,
    dto: MetaEmbeddedSignupDTO,
  ): Promise<Result<WhatsAppConnectionCreatedDTO>> {
    const fail = (reason: string) =>
      auditMutation({
        entity: 'whatsapp_connection',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason,
        meta: { via: 'embedded_signup' },
      })

    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) {
      fail(privileged.error.code)
      return privileged
    }

    const appId = WHATSAPP_META_APP_ID ?? NEXT_PUBLIC_META_APP_ID
    if (!appId || !WHATSAPP_META_APP_SECRET) {
      return err(
        featureNotEnabled(
          'A conexão pela Meta não está configurada neste ambiente',
        ),
      )
    }

    const token = await exchangeSignupCode(
      { appId, appSecret: WHATSAPP_META_APP_SECRET },
      dto.code,
    )
    if (!token.ok) {
      fail(token.error.code)
      return token
    }

    const subscribed = await subscribeAppToWaba(token.value, dto.wabaId)
    if (!subscribed.ok) {
      fail(subscribed.error.code)
      return subscribed
    }

    const pin = generateRegistrationPin()
    const registered = await registerPhoneNumber(
      token.value,
      dto.phoneNumberId,
      pin,
    )
    if (!registered.ok) {
      fail(registered.error.code)
      return registered
    }

    const info = await fetchPhoneInfo(token.value, dto.phoneNumberId)
    if (!info.ok) {
      fail(info.error.code)
      return info
    }

    const created = await WhatsAppConnectionRepository.create({
      workspaceId,
      provider: 'META',
      label:
        dto.label ?? info.value.verifiedName ?? info.value.displayPhoneNumber,
      phoneNumber: info.value.displayPhoneNumber,
      metaPhoneNumberId: dto.phoneNumberId,
      metaWabaId: dto.wabaId,
      encryptedMetaAccessToken: await encryptConnectionSecret(token.value),
      encryptedMetaPin: await encryptConnectionSecret(pin),
      createdById: actorId,
    })
    if (!created.ok) {
      fail(created.error.code)
      return created
    }

    logger.info('whatsapp.connection.embedded_signup', {
      workspaceId,
      connectionId: created.value.id,
    })
    auditMutation({
      entity: 'whatsapp_connection',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { provider: 'META', via: 'embedded_signup' },
    })

    const checked = await applyMetaStatus(created.value, 'test', actorId)
    return ok(
      toWhatsAppConnectionCreatedDTO(
        checked.ok ? checked.value : created.value,
      ),
    )
  },

  async update(
    actorId: string,
    workspaceId: string,
    id: string,
    dto: UpdateWhatsAppConnectionDTO,
  ): Promise<Result<WhatsAppConnectionDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged

    const existing = await WhatsAppConnectionRepository.findById(
      id,
      workspaceId,
    )
    if (!existing.ok) return existing
    if (!existing.value) return err(whatsappConnectionNotFound())

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

    const result = await WhatsAppConnectionRepository.update(id, data)
    if (!result.ok) {
      auditMutation({
        entity: 'whatsapp_connection',
        action: 'update',
        actorId,
        targetId: id,
        outcome: 'failure',
        reason: result.error.code,
      })
      return result
    }

    auditMutation({
      entity: 'whatsapp_connection',
      action: 'update',
      actorId,
      targetId: id,
      meta: { fields: Object.keys(dto) },
    })

    return ok(toWhatsAppConnectionDTO(result.value))
  },

  async remove(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<void>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged

    const existing = await WhatsAppConnectionRepository.findById(
      id,
      workspaceId,
    )
    if (!existing.ok) return existing
    if (!existing.value) return err(whatsappConnectionNotFound())

    const result = await WhatsAppConnectionRepository.delete(id)
    if (!result.ok) return result

    auditMutation({
      entity: 'whatsapp_connection',
      action: 'delete',
      actorId,
      targetId: id,
    })

    return ok(undefined)
  },

  async getQrCode(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<{ status: string; qrCodeBase64?: string }>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!privileged.ok) return privileged

    const existing = await WhatsAppConnectionRepository.findById(
      id,
      workspaceId,
    )
    if (!existing.ok) return existing
    if (!existing.value) return err(whatsappConnectionNotFound())

    const connection = existing.value
    if (connection.provider !== 'ZAPI') {
      return err(
        badRequest('QR code está disponível apenas para conexões Z-API'),
      )
    }
    if (!connection.zapiInstanceId || !connection.encryptedZapiToken) {
      return err(badRequest('Conexão Z-API sem credenciais configuradas'))
    }

    const token = await decryptConnectionSecret(connection.encryptedZapiToken)
    const clientToken = connection.encryptedZapiClientToken
      ? await decryptConnectionSecret(connection.encryptedZapiClientToken)
      : undefined

    const client = createZapiClient({
      instanceId: connection.zapiInstanceId,
      token,
      clientToken,
    })

    let qr: Awaited<ReturnType<typeof client.getQrCode>>
    try {
      qr = await client.getQrCode()
    } catch (error) {
      // Surface the provider's reason (e.g. missing Client-Token) instead of
      // a bare 500, and keep it on the connection for the settings screen.
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Falha ao comunicar com a Z-API'
      await WhatsAppConnectionRepository.update(id, { statusError: message })
      return err(whatsappProviderError(message))
    }

    const newStatus = qr.status === 'connected' ? 'CONNECTED' : 'CONNECTING'
    if (newStatus !== connection.status || connection.statusError) {
      await WhatsAppConnectionRepository.update(id, {
        status: newStatus,
        statusError: null,
      })
    }

    return ok(qr)
  },
}
