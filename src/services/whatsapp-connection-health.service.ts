import type { WhatsAppConnection } from '@prisma/client'
import { logger } from '@/lib/axiom/logger'
import { ok, type Result } from '@/src/lib/result'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { notifyWhatsAppUsers, whatsAppAdminIds } from './whatsapp-notify'

/**
 * Health of a WhatsApp connection (Comunicação or ServiceDesk), fed by the
 * provider webhooks and the manual "test connection". A connection that was
 * CONNECTED and goes down raises `WHATSAPP_CONNECTION_LOST` to the workspace
 * admins **once per transition**: the status change is conditional, so while
 * it stays down (repeated callbacks, repeated tests) nobody is told again.
 */

export type WhatsAppConnectionDownStatus = 'DISCONNECTED' | 'ERROR'

export type WhatsAppConnectionHealthSource =
  | 'zapi_webhook'
  | 'meta_webhook'
  | 'test'

/**
 * Meta error codes that mean the number itself stopped working (not a single
 * undeliverable message): expired/invalid token, account restricted or
 * locked, number not registered / deregistered.
 */
export const META_CONNECTION_ERROR_CODES = new Set([
  190, 368, 131031, 131045, 133010,
])

export interface MetaStatusError {
  code?: number
  title?: string
  message?: string
}

/**
 * The connection-level problem in a Meta `failed` status, if any (`null` =
 * just this message failed, the number is fine).
 */
export function metaConnectionError(
  errors: MetaStatusError[] | undefined,
): string | null {
  const hit = errors?.find(
    (error) =>
      typeof error.code === 'number' &&
      META_CONNECTION_ERROR_CODES.has(error.code),
  )
  if (!hit) return null
  return hit.title ?? hit.message ?? `Erro ${hit.code} da Meta`
}

function settingsPath(connection: WhatsAppConnection): string {
  return connection.module === 'SERVICE_DESK'
    ? '/servicedesk/settings?tab=whatsapp'
    : '/settings/whatsapp'
}

export const WhatsAppConnectionHealthService = {
  /**
   * Marks the connection down. Returns `true` when this call took it out of
   * CONNECTED (and the admins were told), `false` when it was already down.
   */
  async markDown(
    connection: WhatsAppConnection,
    input: {
      status: WhatsAppConnectionDownStatus
      error: string | null
      source: WhatsAppConnectionHealthSource
      /** Who triggered it (manual test) — never notified. */
      actorId?: string | null
    },
  ): Promise<Result<boolean>> {
    const data = { status: input.status, statusError: input.error }
    const lost = await WhatsAppConnectionRepository.transitionStatus(
      connection.id,
      ['CONNECTED'],
      data,
    )
    if (!lost.ok) return lost
    if (!lost.value) {
      // Already down (or still pairing): keep the latest status/error, no
      // notice.
      const updated = await WhatsAppConnectionRepository.update(
        connection.id,
        data,
      )
      if (!updated.ok) return updated
      return ok(false)
    }

    logger.warn('whatsapp.connection.lost', {
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
      module: connection.module,
      status: input.status,
      source: input.source,
    })
    await notifyWhatsAppUsers({
      workspaceId: connection.workspaceId,
      kind: 'WHATSAPP_CONNECTION_LOST',
      userIds: await whatsAppAdminIds(connection.workspaceId),
      actorId: input.actorId,
      title: `Conexão do WhatsApp caiu: ${connection.label}`,
      body: `${connection.phoneNumber} parou de responder${
        input.error ? ` (${input.error})` : ''
      }. Reconecte para voltar a enviar e receber mensagens.`,
      path: settingsPath(connection),
      meta: { connectionId: connection.id, source: input.source },
    })
    return ok(true)
  },

  /** Marks the connection up again (re-arms the next "lost" notice). */
  async markUp(connection: WhatsAppConnection): Promise<Result<boolean>> {
    return WhatsAppConnectionRepository.transitionStatus(
      connection.id,
      ['CONNECTING', 'DISCONNECTED', 'ERROR'],
      { status: 'CONNECTED', statusError: null },
    )
  },
}
