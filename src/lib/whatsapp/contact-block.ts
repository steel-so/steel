import 'server-only'
import type { WhatsAppConnection } from '@prisma/client'
import { logger } from '@/lib/axiom/logger'
import { decryptConnectionSecret } from '@/src/lib/crypto'
import { META_GRAPH_BASE_URL, type MetaCredentials } from './meta-client'
import { isWhatsAppPhone } from './phone'
import { type ZapiCredentials, zapiErrorMessage } from './zapi-client'

/**
 * Blocking a contact at the provider (zap-block-contacts).
 *
 * - Meta Cloud API — Block Users API: `POST|DELETE|GET
 *   /{phone_number_id}/block_users`. Meta only blocks someone who messaged
 *   the business in the last 24 h (per-user error 131047): the block then
 *   stays PENDING and is applied when the person writes again.
 * - Z-API: `POST /contacts/modify-blocked` (`action: block | unblock`), a
 *   regular WhatsApp block on the device, no 24 h rule. Z-API has no
 *   endpoint that lists the device's block list (its "disallowed contacts"
 *   are privacy exceptions, not blocks), so a Z-API sync only retries.
 */

export type ProviderBlockStatus = 'APPLIED' | 'PENDING' | 'FAILED'

export interface ProviderBlockOutcome {
  status: ProviderBlockStatus
  /** pt-BR reason when the status is not APPLIED. */
  error: string | null
}

export interface ProviderUnblockOutcome {
  ok: boolean
  error: string | null
}

export type ProviderBlockList =
  | { supported: true; waIds: string[] }
  | { supported: false; waIds: [] }

export interface ProviderBlockClient {
  block(waId: string): Promise<ProviderBlockOutcome>
  unblock(waId: string): Promise<ProviderUnblockOutcome>
  /** Every number blocked at the provider; throws when the call fails. */
  list(): Promise<ProviderBlockList>
}

/** Meta's per-user error: the person did not write in the last 24 h. */
export const META_REENGAGEMENT_CODE = 131047

/** A slow provider must not hold a webhook or the inbox hostage. */
const REQUEST_TIMEOUT_MS = 10_000

/** Safety stop of the Meta list pagination (64,000 users max per number). */
const META_LIST_PAGE_SIZE = 1000
const META_LIST_MAX_PAGES = 70

export const BLOCK_PENDING_META_MESSAGE =
  'A Meta só aceita bloquear quem escreveu para este número nas últimas 24 horas. O contato já está bloqueado no Steel (nada chega e nada sai) e o bloqueio vai para a Meta assim que a pessoa escrever de novo.'

const META_ERROR_MESSAGES: Record<number, string> = {
  139101:
    'A lista de bloqueio deste número na Meta está cheia (limite de 64.000 contatos).',
  131021: 'Não é possível bloquear o próprio número.',
  130429: 'A Meta limitou as chamadas agora. Tente sincronizar mais tarde.',
  139103: 'A Meta teve um erro interno. Tente sincronizar mais tarde.',
  100: 'A Meta não reconheceu o número deste contato.',
}

/**
 * Normalized key of a blocked recipient: the digits of a phone typed in any
 * format (`+55 (11) 99999-0000`), or the value as is for a BSUID (`BR.123…`)
 * or a group id.
 */
export function normalizeBlockWaId(value: string): string {
  const trimmed = value.trim()
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length > 0 && /^[\d\s()+.-]+$/.test(trimmed)) return digits
  return trimmed
}

/**
 * Keys that identify the same Brazilian mobile: Meta's `wa_id` may come
 * without the ninth digit (`55 11 9xxxx-xxxx` → `55 11 xxxx-xxxx`), and a
 * number typed by a person usually has it. Other numbers: only themselves.
 */
export function blockWaIdVariants(value: string): string[] {
  const waId = normalizeBlockWaId(value)
  if (!isWhatsAppPhone(waId) || !waId.startsWith('55')) return [waId]
  if (waId.length === 13 && waId[4] === '9') {
    return [waId, `${waId.slice(0, 4)}${waId.slice(5)}`]
  }
  if (waId.length === 12 && /[6-9]/.test(waId[4])) {
    return [waId, `${waId.slice(0, 4)}9${waId.slice(4)}`]
  }
  return [waId]
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Digits of a phone in the logs: personal data (LGPD), never in full. */
function maskWaId(waId: string): string {
  return waId.length > 4 ? `${waId.slice(0, 4)}****` : '****'
}

interface MetaUserError {
  code?: number
  message?: string
  error_data?: { details?: string }
}

interface MetaBlockUserRow {
  input?: string
  wa_id?: string
  user_id?: string
  errors?: MetaUserError[]
}

interface MetaBlockBody {
  block_users?: {
    added_users?: MetaBlockUserRow[]
    removed_users?: MetaBlockUserRow[]
    failed_users?: MetaBlockUserRow[]
  }
  error?: MetaUserError
}

function metaUser(waId: string): Record<string, string> {
  return isWhatsAppPhone(waId) ? { user: waId } : { user_id: waId }
}

function metaErrorMessage(
  error: MetaUserError | undefined,
  action: 'bloqueio' | 'desbloqueio',
): string {
  if (error?.code !== undefined && META_ERROR_MESSAGES[error.code]) {
    return META_ERROR_MESSAGES[error.code]
  }
  const detail = error?.error_data?.details ?? error?.message
  return detail
    ? `A Meta recusou o ${action}: ${detail}`
    : `A Meta recusou o ${action}.`
}

async function metaBlockCall(
  credentials: MetaCredentials,
  method: 'POST' | 'DELETE',
  waId: string,
): Promise<{ status: number; body: MetaBlockBody | null }> {
  const response = await fetch(
    `${META_GRAPH_BASE_URL}/${credentials.phoneNumberId}/block_users`,
    {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${credentials.accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        block_users: [metaUser(waId)],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  )
  const body = (await response
    .json()
    .catch(() => null)) as MetaBlockBody | null
  if (!response.ok) {
    logger.warn('whatsapp.contact_block.meta_failed', {
      method,
      status: response.status,
      code: body?.error?.code ?? null,
      user: maskWaId(waId),
    })
  }
  return { status: response.status, body }
}

/** The per-user error of a Meta answer (partial failure or plain error). */
function metaFailure(body: MetaBlockBody | null): MetaUserError | undefined {
  const failed = body?.block_users?.failed_users?.[0]
  return failed?.errors?.[0] ?? body?.error
}

export function createMetaBlockClient(
  credentials: MetaCredentials,
): ProviderBlockClient {
  return {
    async block(waId) {
      try {
        const { status, body } = await metaBlockCall(credentials, 'POST', waId)
        if (status < 400 && (body?.block_users?.added_users?.length ?? 0) > 0) {
          return { status: 'APPLIED', error: null }
        }
        const failure = metaFailure(body)
        if (status < 400 && !failure) return { status: 'APPLIED', error: null }
        if (failure?.code === META_REENGAGEMENT_CODE) {
          return { status: 'PENDING', error: BLOCK_PENDING_META_MESSAGE }
        }
        return {
          status: 'FAILED',
          error: metaErrorMessage(failure, 'bloqueio'),
        }
      } catch (error) {
        return {
          status: 'FAILED',
          error: `Não foi possível falar com a Meta: ${reasonOf(error)}`,
        }
      }
    },

    async unblock(waId) {
      try {
        const { status, body } = await metaBlockCall(
          credentials,
          'DELETE',
          waId,
        )
        const failure = metaFailure(body)
        if (status < 400 && !body?.block_users?.failed_users?.length) {
          return { ok: true, error: null }
        }
        return { ok: false, error: metaErrorMessage(failure, 'desbloqueio') }
      } catch (error) {
        return {
          ok: false,
          error: `Não foi possível falar com a Meta: ${reasonOf(error)}`,
        }
      }
    },

    async list() {
      const waIds: string[] = []
      let after: string | undefined
      for (let page = 0; page < META_LIST_MAX_PAGES; page += 1) {
        const query = new URLSearchParams({
          limit: String(META_LIST_PAGE_SIZE),
        })
        if (after) query.set('after', after)
        const response = await fetch(
          `${META_GRAPH_BASE_URL}/${credentials.phoneNumberId}/block_users?${query}`,
          {
            headers: { Authorization: `Bearer ${credentials.accessToken}` },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          },
        )
        const body = (await response.json().catch(() => null)) as {
          data?: { wa_id?: string; user_id?: string }[]
          paging?: { cursors?: { after?: string }; next?: string }
          error?: MetaUserError
        } | null
        if (!response.ok) {
          throw new Error(
            body?.error?.message
              ? `A Meta recusou a lista de bloqueados: ${body.error.message}`
              : `A Meta recusou a lista de bloqueados (${response.status})`,
          )
        }
        const rows = body?.data ?? []
        for (const row of rows) {
          const id = row.wa_id ?? row.user_id
          if (id) waIds.push(normalizeBlockWaId(id))
        }
        const next = body?.paging?.cursors?.after
        if (rows.length === 0 || !next || next === after) break
        after = next
      }
      return { supported: true, waIds }
    },
  }
}

async function zapiModifyBlocked(
  credentials: ZapiCredentials,
  waId: string,
  action: 'block' | 'unblock',
): Promise<{ ok: boolean; error: string | null }> {
  if (!isWhatsAppPhone(waId)) {
    return {
      ok: false,
      error: 'A Z-API só bloqueia contatos com número de telefone.',
    }
  }
  try {
    const response = await fetch(
      `https://api.z-api.io/instances/${credentials.instanceId}/token/${credentials.token}/contacts/modify-blocked`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(credentials.clientToken
            ? { 'Client-Token': credentials.clientToken }
            : {}),
        },
        body: JSON.stringify({ phone: waId, action }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    )
    const body = (await response.json().catch(() => null)) as {
      value?: unknown
    } | null
    if (!response.ok) {
      logger.warn('whatsapp.contact_block.zapi_failed', {
        action,
        status: response.status,
        user: maskWaId(waId),
      })
      return { ok: false, error: zapiErrorMessage(body, response.status) }
    }
    if (body?.value === false) {
      return {
        ok: false,
        error:
          action === 'block'
            ? 'A Z-API não conseguiu bloquear o contato no aparelho. Confira se a instância está conectada.'
            : 'A Z-API não conseguiu desbloquear o contato no aparelho. Confira se a instância está conectada.',
      }
    }
    return { ok: true, error: null }
  } catch (error) {
    return {
      ok: false,
      error: `Não foi possível falar com a Z-API: ${reasonOf(error)}`,
    }
  }
}

export function createZapiBlockClient(
  credentials: ZapiCredentials,
): ProviderBlockClient {
  return {
    async block(waId) {
      const result = await zapiModifyBlocked(credentials, waId, 'block')
      return result.ok
        ? { status: 'APPLIED', error: null }
        : { status: 'FAILED', error: result.error }
    },
    unblock(waId) {
      return zapiModifyBlocked(credentials, waId, 'unblock')
    },
    async list() {
      return { supported: false, waIds: [] }
    },
  }
}

/**
 * Block client of a connection, or null when it cannot block at the
 * provider (site widget, credentials missing).
 */
export async function resolveBlockClient(
  connection: WhatsAppConnection,
): Promise<ProviderBlockClient | null> {
  if (connection.provider === 'ZAPI') {
    if (!connection.zapiInstanceId || !connection.encryptedZapiToken) {
      return null
    }
    return createZapiBlockClient({
      instanceId: connection.zapiInstanceId,
      token: await decryptConnectionSecret(connection.encryptedZapiToken),
      clientToken: connection.encryptedZapiClientToken
        ? await decryptConnectionSecret(connection.encryptedZapiClientToken)
        : undefined,
    })
  }
  if (connection.provider === 'META') {
    if (
      !connection.metaPhoneNumberId ||
      !connection.metaWabaId ||
      !connection.encryptedMetaAccessToken
    ) {
      return null
    }
    return createMetaBlockClient({
      phoneNumberId: connection.metaPhoneNumberId,
      wabaId: connection.metaWabaId,
      accessToken: await decryptConnectionSecret(
        connection.encryptedMetaAccessToken,
      ),
    })
  }
  return null
}
