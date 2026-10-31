import 'server-only'
import { logger } from '@/lib/axiom/logger'
import { whatsappProviderError } from '@/src/errors'
import type { AppError } from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'
import { META_GRAPH_BASE_URL } from './meta-client'

/**
 * WhatsApp Coexistence (Z6): the customer keeps the number in the WhatsApp
 * Business app and the Cloud API runs on the same number. After the Embedded
 * Signup, Meta streams the contacts (`smb_app_state_sync`), the chat history
 * (`history`) and the messages typed in the app (`smb_message_echoes`) as
 * webhooks. The sync must be requested within 24 hours of onboarding.
 */

export type CoexistenceSyncType = 'smb_app_state_sync' | 'history'

/** Meta error codes that mean the customer refused to share the history. */
const HISTORY_DECLINED_CODES = [2593109, 2593107]

export type CoexistenceMessageType =
  | 'TEXT'
  | 'IMAGE'
  | 'AUDIO'
  | 'VIDEO'
  | 'DOCUMENT'
  | 'STICKER'
  | 'LOCATION'
  | 'CONTACT'

export interface CoexistenceMessage {
  waId: string
  providerMessageId: string
  direction: 'IN' | 'OUT'
  type: CoexistenceMessageType
  text: string | null
  status: 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'
  at: Date
}

export interface CoexistenceHistoryChunk {
  phase: number | null
  progress: number | null
  messages: CoexistenceMessage[]
}

interface RawHistoryMessage {
  id?: string
  from?: string
  to?: string
  timestamp?: string | number
  type?: string
  text?: { body?: string }
  image?: { caption?: string }
  video?: { caption?: string }
  document?: { caption?: string; filename?: string }
  history_context?: { status?: string }
}

interface RawHistoryEntry {
  metadata?: { phase?: number; chunk_order?: number; progress?: number }
  threads?: { id?: string; messages?: RawHistoryMessage[] }[]
  errors?: { code?: number; title?: string }[]
}

const digits = (value: string | undefined) => (value ?? '').replace(/\D/g, '')

const PLACEHOLDER: Record<string, [CoexistenceMessageType, string]> = {
  image: ['IMAGE', '[Imagem]'],
  video: ['VIDEO', '[Vídeo]'],
  audio: ['AUDIO', '[Áudio]'],
  voice: ['AUDIO', '[Áudio]'],
  document: ['DOCUMENT', '[Documento]'],
  sticker: ['STICKER', '[Figurinha]'],
  location: ['LOCATION', '[Localização]'],
  contacts: ['CONTACT', '[Contato]'],
}

/** Type and text of a history / echo message. Media bodies are not downloadable. */
export function coexistenceContent(message: RawHistoryMessage): {
  type: CoexistenceMessageType
  text: string | null
} {
  if (message.type === 'text') {
    return { type: 'TEXT', text: message.text?.body ?? null }
  }
  const placeholder = PLACEHOLDER[message.type ?? '']
  if (!placeholder) {
    return { type: 'TEXT', text: `[Mensagem não suportada: ${message.type}]` }
  }
  const caption =
    message.image?.caption ??
    message.video?.caption ??
    message.document?.caption ??
    message.document?.filename
  return {
    type: placeholder[0],
    text: caption ? `${placeholder[1]} ${caption}` : placeholder[1],
  }
}

const HISTORY_STATUS: Record<string, CoexistenceMessage['status']> = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  READ: 'READ',
  PLAYED: 'READ',
  ERROR: 'FAILED',
}

function toDate(timestamp: string | number | undefined): Date {
  const seconds = Number(timestamp)
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000)
    : new Date()
}

/**
 * Reads a `history` webhook value. `declined` is true when Meta reports the
 * customer refused to share the history (the connection still works).
 */
export function parseHistoryWebhook(value: {
  history?: RawHistoryEntry[]
}): { declined: boolean; chunks: CoexistenceHistoryChunk[] } {
  const chunks: CoexistenceHistoryChunk[] = []
  let declined = false
  for (const entry of value.history ?? []) {
    const refused = entry.errors?.some((e) =>
      HISTORY_DECLINED_CODES.includes(e.code ?? 0),
    )
    if (refused) {
      declined = true
      continue
    }
    const messages: CoexistenceMessage[] = []
    for (const thread of entry.threads ?? []) {
      const customer = digits(thread.id)
      if (!customer) continue
      for (const message of thread.messages ?? []) {
        if (!message.id) continue
        const content = coexistenceContent(message)
        messages.push({
          waId: customer,
          providerMessageId: message.id,
          direction: digits(message.from) === customer ? 'IN' : 'OUT',
          type: content.type,
          text: content.text,
          status:
            HISTORY_STATUS[message.history_context?.status ?? ''] ?? 'SENT',
          at: toDate(message.timestamp),
        })
      }
    }
    chunks.push({
      phase: entry.metadata?.phase ?? null,
      progress: entry.metadata?.progress ?? null,
      messages,
    })
  }
  return { declined, chunks }
}

export interface CoexistenceContact {
  waId: string
  name: string | null
}

/** Contacts added or edited in the app (`smb_app_state_sync`). */
export function parseContactSync(value: {
  state_sync?: {
    type?: string
    action?: string
    contact?: {
      full_name?: string
      first_name?: string
      phone_number?: string
    }
  }[]
}): CoexistenceContact[] {
  const contacts: CoexistenceContact[] = []
  for (const item of value.state_sync ?? []) {
    if (item.type !== 'contact' || item.action === 'remove') continue
    const waId = digits(item.contact?.phone_number)
    if (!waId) continue
    contacts.push({
      waId,
      name: item.contact?.full_name ?? item.contact?.first_name ?? null,
    })
  }
  return contacts
}

export interface CoexistenceEcho {
  waId: string
  providerMessageId: string
  type: CoexistenceMessageType
  text: string | null
}

/** Messages typed in the WhatsApp Business app (`smb_message_echoes`). */
export function parseMessageEchoes(value: {
  message_echoes?: (RawHistoryMessage & { to?: string })[]
}): CoexistenceEcho[] {
  const echoes: CoexistenceEcho[] = []
  for (const echo of value.message_echoes ?? []) {
    const waId = digits(echo.to)
    if (!echo.id || !waId) continue
    const content = coexistenceContent(echo)
    echoes.push({
      waId,
      providerMessageId: echo.id,
      type: content.type,
      text: content.text,
    })
  }
  return echoes
}

/**
 * Asks Meta to start streaming the contacts or the history. Must run within
 * 24 hours of the onboarding; the data then arrives as webhooks.
 */
export async function requestCoexistenceSync(
  token: string,
  phoneNumberId: string,
  syncType: CoexistenceSyncType,
): Promise<Result<true, AppError>> {
  try {
    const response = await fetch(
      `${META_GRAPH_BASE_URL}/${phoneNumberId}/smb_app_data`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          sync_type: syncType,
        }),
      },
    )
    if (response.ok) return ok(true)
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string; code?: number }
    } | null
    logger.warn('whatsapp.coexistence.sync_request_failed', {
      syncType,
      status: response.status,
      code: body?.error?.code,
    })
    return err(
      whatsappProviderError(
        'A Meta recusou o pedido de importação. Tente de novo em alguns minutos.',
      ),
    )
  } catch {
    return err(whatsappProviderError('Não foi possível falar com a Meta'))
  }
}
