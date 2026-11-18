import type { PlatformZapiLine } from '@prisma/client'
import { logger } from '@/lib/axiom/logger'
import {
  databaseError,
  notFound,
  whatsappProviderError,
  whatsappValidationUnavailable,
} from '@/src/errors'
import { type AdminActor, recordAdminAction } from '@/src/lib/admin-audit'
import {
  decryptConnectionSecret,
  encryptConnectionSecret,
} from '@/src/lib/crypto'
import { err, ok, type Result } from '@/src/lib/result'
import type { WhatsAppQrCode } from '@/src/lib/whatsapp/types'
import {
  createZapiClient,
  disconnectZapiInstance,
  getZapiInstancePhone,
  getZapiInstanceStatus,
  restartZapiInstance,
  type ZapiCredentials,
} from '@/src/lib/whatsapp/zapi-client'
import { toPlatformZapiLineDTO } from '@/src/mappers/platform-zapi-line.mapper'
import { PlatformZapiLineRepository } from '@/src/repositories/platform-zapi-line.repository'
import type {
  PlatformZapiLineActionDTO,
  SavePlatformZapiLineDTO,
} from '@/src/schemas/platform-zapi-line.schema'
import type {
  PlatformZapiLineDTO,
  PlatformZapiLineQrCodeDTO,
} from '@/types/platform-zapi-line'
import { assertPlatformAdmin } from './authz'

/** What a workspace user reads when the shared line cannot answer. */
export const PLATFORM_LINE_UNAVAILABLE_MESSAGE =
  'A linha de verificação da plataforma está desconectada; peça a um administrador da plataforma para reconectar.'

/** A connected line is re-checked on Z-API after this long. */
export const CONNECTED_STATUS_FRESH_MS = 5 * 60 * 1000
/** A line that is not connected is re-checked sooner: it may have come back. */
export const OFFLINE_STATUS_FRESH_MS = 60 * 1000

const LINE_LABEL = 'Linha de verificação (Z-API)'

const providerMessage = (error: unknown): string =>
  error instanceof Error && error.message
    ? error.message
    : 'Falha ao comunicar com a Z-API'

async function credentialsOf(row: PlatformZapiLine): Promise<ZapiCredentials> {
  return {
    instanceId: row.instanceId,
    token: await decryptConnectionSecret(row.encryptedToken),
    clientToken: row.encryptedClientToken
      ? await decryptConnectionSecret(row.encryptedClientToken)
      : undefined,
  }
}

/**
 * Asks Z-API for the live state of the line and saves it. Never throws: a
 * provider failure becomes the ERROR state (credentials wrong, Z-API down).
 * Not connected means DISCONNECTED, or AWAITING_QR while a scan is pending.
 */
async function refreshLive(
  row: PlatformZapiLine,
  credentials: ZapiCredentials,
  updatedById?: string,
): Promise<Result<PlatformZapiLine>> {
  let saved: Result<PlatformZapiLine | null>
  try {
    const live = await getZapiInstanceStatus(credentials)
    if (live.connected) {
      let phone = row.phone
      try {
        phone = (await getZapiInstancePhone(credentials)) ?? row.phone
      } catch {
        // The number is informational; the line works without it.
      }
      saved = await PlatformZapiLineRepository.updateStatus(
        {
          status: 'CONNECTED',
          statusError: null,
          phone,
          connectedAt: row.connectedAt ?? new Date(),
        },
        updatedById,
      )
    } else {
      saved = await PlatformZapiLineRepository.updateStatus(
        {
          status: row.status === 'AWAITING_QR' ? 'AWAITING_QR' : 'DISCONNECTED',
          statusError: null,
          phone: null,
          connectedAt: null,
        },
        updatedById,
      )
    }
  } catch (error) {
    saved = await PlatformZapiLineRepository.updateStatus(
      { status: 'ERROR', statusError: providerMessage(error) },
      updatedById,
    )
  }
  if (!saved.ok) return saved
  if (!saved.value) return err(notFound('Linha de verificação'))
  return ok(saved.value)
}

type LoadedLine = { row: PlatformZapiLine; credentials: ZapiCredentials }

async function loadLine(): Promise<Result<LoadedLine | null>> {
  const found = await PlatformZapiLineRepository.find()
  if (!found.ok) return found
  if (!found.value) return ok(null)
  try {
    return ok({
      row: found.value,
      credentials: await credentialsOf(found.value),
    })
  } catch (error) {
    logger.error('whatsapp.platform_line.decrypt_failed', {
      component: 'PlatformZapiLineService',
      reason: error instanceof Error ? error.message : 'unknown',
    })
    return err(databaseError('Failed to read the platform line credentials'))
  }
}

async function loadForAdmin(
  actorId: string,
): Promise<Result<{ admin: AdminActor; line: LoadedLine }>> {
  const admin = await assertPlatformAdmin(actorId)
  if (!admin.ok) return admin
  const loaded = await loadLine()
  if (!loaded.ok) return loaded
  if (!loaded.value) return err(notFound('Linha de verificação'))
  return ok({ admin: admin.value, line: loaded.value })
}

function audit(
  admin: AdminActor,
  action: string,
  auditAction: 'create' | 'update' | 'delete',
  reason: string | null | undefined,
  meta?: Record<string, unknown>,
) {
  return recordAdminAction({
    actor: admin,
    action: `zapi_line.${action}`,
    audit: { entity: 'platform_zapi_line', action: auditAction },
    targetType: 'platform',
    targetId: 'default',
    targetLabel: LINE_LABEL,
    reason: reason ?? null,
    meta,
  })
}

/**
 * The platform verification line (ADR 0069): the ONE Z-API number, managed in
 * the global admin, that answers the "has WhatsApp?" check of every
 * workspace. Admin methods are platform-admin only; the system methods at the
 * bottom are what validation (app and worker) uses and never expose tokens.
 */
export const PlatformZapiLineService = {
  async get(actorId: string): Promise<Result<PlatformZapiLineDTO>> {
    const admin = await assertPlatformAdmin(actorId)
    if (!admin.ok) return admin
    const found = await PlatformZapiLineRepository.find()
    if (!found.ok) return found
    return ok(toPlatformZapiLineDTO(found.value))
  },

  /** Saves or replaces the credentials; the line starts disconnected. */
  async save(
    actorId: string,
    input: SavePlatformZapiLineDTO,
  ): Promise<Result<PlatformZapiLineDTO>> {
    const admin = await assertPlatformAdmin(actorId)
    if (!admin.ok) return admin

    const previous = await PlatformZapiLineRepository.find()
    if (!previous.ok) return previous

    const saved = await PlatformZapiLineRepository.upsertCredentials({
      instanceId: input.instanceId,
      encryptedToken: await encryptConnectionSecret(input.token),
      encryptedClientToken: input.clientToken
        ? await encryptConnectionSecret(input.clientToken)
        : null,
      label: input.label ?? null,
      updatedById: actorId,
    })
    if (!saved.ok) return saved

    await audit(
      admin.value,
      previous.value ? 'replace_credentials' : 'configure',
      previous.value ? 'update' : 'create',
      input.reason,
      {
        replaced: previous.value !== null,
        hasClientToken: input.clientToken !== undefined,
      },
    )
    return ok(toPlatformZapiLineDTO(saved.value))
  },

  /** Live status (button "Atualizar" and the polling of the admin screen). */
  async refreshStatus(actorId: string): Promise<Result<PlatformZapiLineDTO>> {
    const admin = await assertPlatformAdmin(actorId)
    if (!admin.ok) return admin
    const loaded = await loadLine()
    if (!loaded.ok) return loaded
    if (!loaded.value) return ok(toPlatformZapiLineDTO(null))

    const refreshed = await refreshLive(
      loaded.value.row,
      loaded.value.credentials,
      actorId,
    )
    if (!refreshed.ok) return refreshed
    return ok(toPlatformZapiLineDTO(refreshed.value))
  },

  /** QR code to pair the phone; saves "connected" once Z-API reports it. */
  async getQrCode(actorId: string): Promise<Result<PlatformZapiLineQrCodeDTO>> {
    const loaded = await loadForAdmin(actorId)
    if (!loaded.ok) return loaded
    const { row, credentials } = loaded.value.line

    let qr: WhatsAppQrCode
    try {
      qr = await createZapiClient(credentials).getQrCode()
    } catch (error) {
      const message = providerMessage(error)
      await PlatformZapiLineRepository.updateStatus(
        { status: 'ERROR', statusError: message },
        actorId,
      )
      return err(whatsappProviderError(message))
    }

    if (qr.status === 'connected') {
      const refreshed = await refreshLive(row, credentials, actorId)
      if (!refreshed.ok) return refreshed
      return ok({
        status: 'connected',
        line: toPlatformZapiLineDTO(refreshed.value),
      })
    }

    const updated = await PlatformZapiLineRepository.updateStatus(
      {
        status: 'AWAITING_QR',
        statusError: null,
        phone: null,
        connectedAt: null,
      },
      actorId,
    )
    if (!updated.ok) return updated
    return ok({
      status: 'awaiting_scan',
      qrCodeBase64: qr.qrCodeBase64,
      line: toPlatformZapiLineDTO(updated.value),
    })
  },

  /** Restarts the Z-API session, then reads the state back. */
  async restart(
    actorId: string,
    input: PlatformZapiLineActionDTO,
  ): Promise<Result<PlatformZapiLineDTO>> {
    const loaded = await loadForAdmin(actorId)
    if (!loaded.ok) return loaded
    const { row, credentials } = loaded.value.line

    try {
      await restartZapiInstance(credentials)
    } catch (error) {
      return err(whatsappProviderError(providerMessage(error)))
    }
    await audit(loaded.value.admin, 'restart', 'update', input.reason)

    const refreshed = await refreshLive(row, credentials, actorId)
    if (!refreshed.ok) return refreshed
    return ok(toPlatformZapiLineDTO(refreshed.value))
  },

  /** Unpairs the phone on Z-API; workspaces get "unavailable" until a rescan. */
  async disconnect(
    actorId: string,
    input: PlatformZapiLineActionDTO,
  ): Promise<Result<PlatformZapiLineDTO>> {
    const loaded = await loadForAdmin(actorId)
    if (!loaded.ok) return loaded
    const { credentials } = loaded.value.line

    try {
      await disconnectZapiInstance(credentials)
    } catch (error) {
      return err(whatsappProviderError(providerMessage(error)))
    }
    const updated = await PlatformZapiLineRepository.updateStatus(
      {
        status: 'DISCONNECTED',
        statusError: null,
        phone: null,
        connectedAt: null,
      },
      actorId,
    )
    if (!updated.ok) return updated
    await audit(loaded.value.admin, 'disconnect', 'update', input.reason)
    return ok(toPlatformZapiLineDTO(updated.value))
  },

  /**
   * Forgets the credentials in Steel. The instance itself is left as it is on
   * Z-API (disconnect first to also unpair the phone).
   */
  async remove(
    actorId: string,
    input: PlatformZapiLineActionDTO,
  ): Promise<Result<PlatformZapiLineDTO>> {
    const admin = await assertPlatformAdmin(actorId)
    if (!admin.ok) return admin
    const removed = await PlatformZapiLineRepository.remove()
    if (!removed.ok) return removed
    await audit(admin.value, 'remove', 'delete', input.reason)
    return ok(toPlatformZapiLineDTO(null))
  },

  // ----- System side (validation in the app and in the worker) -----

  /**
   * Whether workspaces can run the check now. Cheap: reads the saved state
   * and only asks Z-API when that state is older than the freshness window.
   */
  async isAvailable(now: number = Date.now()): Promise<Result<boolean>> {
    const loaded = await loadLine()
    if (!loaded.ok) return loaded
    if (!loaded.value) return ok(false)

    let { row } = loaded.value
    const freshMs =
      row.status === 'CONNECTED'
        ? CONNECTED_STATUS_FRESH_MS
        : OFFLINE_STATUS_FRESH_MS
    const checkedAt = row.statusCheckedAt?.getTime() ?? 0
    if (now - checkedAt > freshMs) {
      const refreshed = await refreshLive(row, loaded.value.credentials)
      if (!refreshed.ok) return refreshed
      row = refreshed.value
    }
    return ok(row.status === 'CONNECTED')
  },

  /**
   * Credentials for a validation run, after a live check. Fails with the
   * "unavailable" error (nothing is marked on any contact) when the line is
   * missing or not connected.
   */
  async acquireForValidation(): Promise<Result<ZapiCredentials>> {
    const loaded = await loadLine()
    if (!loaded.ok) return loaded
    if (!loaded.value) {
      return err(
        whatsappValidationUnavailable(PLATFORM_LINE_UNAVAILABLE_MESSAGE),
      )
    }
    const refreshed = await refreshLive(
      loaded.value.row,
      loaded.value.credentials,
    )
    if (!refreshed.ok) return refreshed
    if (refreshed.value.status !== 'CONNECTED') {
      return err(
        whatsappValidationUnavailable(PLATFORM_LINE_UNAVAILABLE_MESSAGE),
      )
    }
    return ok(loaded.value.credentials)
  },

  /**
   * Mid-run guard: true when Z-API definitively says the phone is no longer
   * paired (the saved state is updated so workspaces see "unavailable"). A
   * provider error is not "lost": the chunk itself fails and is retried.
   */
  async isLineLost(credentials: ZapiCredentials): Promise<boolean> {
    try {
      const live = await getZapiInstanceStatus(credentials)
      if (live.connected) return false
    } catch (error) {
      logger.warn('whatsapp.platform_line.status_check_failed', {
        component: 'PlatformZapiLineService',
        reason: providerMessage(error),
      })
      return false
    }
    await PlatformZapiLineRepository.updateStatus({
      status: 'DISCONNECTED',
      statusError: null,
      phone: null,
      connectedAt: null,
    })
    return true
  },
}
