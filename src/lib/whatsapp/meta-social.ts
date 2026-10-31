import 'server-only'
import { logger } from '@/lib/axiom/logger'
import { whatsappProviderError } from '@/src/errors'
import type { AppError } from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'
import { META_GRAPH_BASE_URL } from './meta-client'
import type {
  WhatsAppOutboundMedia,
  WhatsAppProviderClient,
  WhatsAppSendResult,
} from './types'

/**
 * Instagram Direct and Messenger (Z5) over the Graph API, using a Facebook
 * Page access token for both channels. Contacts of these channels are stored
 * with a prefixed identity (`ig:<IGSID>`, `fb:<PSID>`) so they never collide
 * with a phone number. Tokens are never logged.
 */

export type MetaSocialChannel = 'INSTAGRAM' | 'MESSENGER'

export function isSocialChannel(
  channel: string | undefined,
): channel is MetaSocialChannel {
  return channel === 'INSTAGRAM' || channel === 'MESSENGER'
}

const PREFIX: Record<MetaSocialChannel, string> = {
  INSTAGRAM: 'ig:',
  MESSENGER: 'fb:',
}

/** Page fields delivered to us: DMs, echoes of replies sent in the apps, comments. */
export const PAGE_SUBSCRIBED_FIELDS = [
  'messages',
  'messaging_postbacks',
  'message_echoes',
  'feed',
]

export function socialWaId(channel: MetaSocialChannel, id: string): string {
  return `${PREFIX[channel]}${id}`
}

/** `ig:123` -> `{ channel: 'INSTAGRAM', id: '123' }`; anything else -> null. */
export function parseSocialWaId(
  waId: string,
): { channel: MetaSocialChannel; id: string } | null {
  for (const channel of Object.keys(PREFIX) as MetaSocialChannel[]) {
    if (waId.startsWith(PREFIX[channel]) && waId.length > 3) {
      return { channel, id: waId.slice(PREFIX[channel].length) }
    }
  }
  return null
}

export function isSocialWaId(waId: string): boolean {
  return parseSocialWaId(waId) !== null
}

// ─── Webhook parsing ──────────────────────────────────────────────────────

export type SocialEvent =
  | {
      kind: 'message'
      channel: MetaSocialChannel
      /** Page id (Messenger) or Instagram account id (Instagram). */
      accountId: string
      /** The customer (sender of an inbound message, recipient of an echo). */
      contactId: string
      mid: string
      text?: string
      attachmentUrl?: string
      attachmentType?: string
      echo: boolean
    }
  | {
      kind: 'comment'
      channel: MetaSocialChannel
      accountId: string
      contactId: string
      contactName?: string
      commentId: string
      postId?: string
      parentCommentId?: string
      permalink?: string
      text: string
    }

interface RawMessaging {
  sender?: { id?: string }
  recipient?: { id?: string }
  message?: {
    mid?: string
    text?: string
    is_echo?: boolean
    is_deleted?: boolean
    attachments?: { type?: string; payload?: { url?: string } }[]
  }
}

interface RawChange {
  field?: string
  value?: {
    item?: string
    verb?: string
    comment_id?: string
    post_id?: string
    parent_id?: string
    permalink_url?: string
    message?: string
    from?: { id?: string; name?: string; username?: string }
    // Instagram `comments` field.
    id?: string
    text?: string
    media?: { id?: string }
    username?: string
  }
}

interface RawEntry {
  id?: string
  messaging?: RawMessaging[]
  changes?: RawChange[]
}

function messageEvent(
  channel: MetaSocialChannel,
  accountId: string,
  item: RawMessaging,
): SocialEvent | null {
  const message = item.message
  if (!message?.mid || message.is_deleted) return null
  const echo = message.is_echo === true
  // An echo is a reply sent from the Page / Instagram app: the customer is
  // the recipient.
  const contactId = echo ? item.recipient?.id : item.sender?.id
  if (!contactId || contactId === accountId) return null
  const attachment = message.attachments?.[0]
  if (!message.text && !attachment?.payload?.url) return null
  return {
    kind: 'message',
    channel,
    accountId,
    contactId,
    mid: message.mid,
    text: message.text,
    attachmentUrl: attachment?.payload?.url,
    attachmentType: attachment?.type,
    echo,
  }
}

function commentEvent(
  channel: MetaSocialChannel,
  accountId: string,
  change: RawChange,
): SocialEvent | null {
  const value = change.value
  if (!value) return null
  if (channel === 'MESSENGER') {
    if (change.field !== 'feed') return null
    if (value.item !== 'comment' || value.verb !== 'add') return null
    if (!value.comment_id || !value.from?.id || !value.message) return null
    // Comments written by the Page itself are our own answers.
    if (value.from.id === accountId) return null
    return {
      kind: 'comment',
      channel,
      accountId,
      contactId: value.from.id,
      contactName: value.from.name,
      commentId: value.comment_id,
      postId: value.post_id,
      parentCommentId:
        value.parent_id && value.parent_id !== value.post_id
          ? value.parent_id
          : undefined,
      permalink: value.permalink_url,
      text: value.message,
    }
  }
  if (change.field !== 'comments') return null
  if (!value.id || !value.from?.id || !value.text) return null
  if (value.from.id === accountId) return null
  return {
    kind: 'comment',
    channel,
    accountId,
    contactId: value.from.id,
    contactName: value.from.username ?? value.username,
    commentId: value.id,
    postId: value.media?.id,
    parentCommentId: value.parent_id,
    text: value.text,
  }
}

/**
 * Flattens a webhook body (`object: 'page' | 'instagram'`) into events.
 * Anything unsupported (reads, reactions, deletions, own comments) is dropped.
 */
export function parseSocialWebhook(body: unknown): SocialEvent[] {
  if (!body || typeof body !== 'object') return []
  const { object, entry } = body as { object?: string; entry?: RawEntry[] }
  const channel: MetaSocialChannel | null =
    object === 'instagram'
      ? 'INSTAGRAM'
      : object === 'page'
        ? 'MESSENGER'
        : null
  if (!channel || !Array.isArray(entry)) return []

  const events: SocialEvent[] = []
  for (const item of entry) {
    if (!item.id) continue
    for (const messaging of item.messaging ?? []) {
      const event = messageEvent(channel, item.id, messaging)
      if (event) events.push(event)
    }
    for (const change of item.changes ?? []) {
      const event = commentEvent(channel, item.id, change)
      if (event) events.push(event)
    }
  }
  return events
}

/** Text stored for a message that carries only an attachment. */
export function attachmentText(
  type: string | undefined,
  url: string,
  caption?: string,
): string {
  const label =
    type === 'image'
      ? 'Imagem'
      : type === 'video'
        ? 'Vídeo'
        : type === 'audio'
          ? 'Áudio'
          : 'Anexo'
  return caption ? `${caption}\n[${label}] ${url}` : `[${label}] ${url}`
}

// ─── Graph API ────────────────────────────────────────────────────────────

interface GraphErrorBody {
  error?: { message?: string; code?: number; error_user_msg?: string }
}

async function graph<T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<{ ok: true; body: T } | { ok: false; message: string }> {
  try {
    const response = await fetch(`${META_GRAPH_BASE_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    })
    const body = await response.json().catch(() => null)
    if (!response.ok) {
      const failure = body as GraphErrorBody | null
      logger.warn('whatsapp.meta_social.request_failed', {
        path: path.split('?')[0],
        status: response.status,
        code: failure?.error?.code,
      })
      return {
        ok: false,
        message:
          failure?.error?.error_user_msg ??
          failure?.error?.message ??
          `Falha na requisição à Meta (${response.status})`,
      }
    }
    return { ok: true, body: body as T }
  } catch {
    return { ok: false, message: 'Não foi possível falar com a Meta' }
  }
}

function failure(message: string): AppError {
  return whatsappProviderError(message)
}

export interface MetaManagedPage {
  id: string
  name: string
  accessToken: string
  instagram: { id: string; username: string | null } | null
}

/** Swaps a short-lived user token for a long-lived one (60 days). */
export async function exchangeLongLivedToken(
  app: { appId: string; appSecret: string },
  userToken: string,
): Promise<Result<string, AppError>> {
  const query = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: app.appId,
    client_secret: app.appSecret,
    fb_exchange_token: userToken,
  })
  const res = await graph<{ access_token?: string }>(
    `/oauth/access_token?${query.toString()}`,
    userToken,
    { method: 'GET' },
  )
  if (!res.ok) return err(failure(res.message))
  if (!res.body.access_token) {
    return err(failure('A Meta não devolveu o token de acesso'))
  }
  return ok(res.body.access_token)
}

/**
 * Pages the user manages, with their (non-expiring) page tokens and the
 * linked Instagram professional account, if any.
 */
export async function listManagedPages(
  userToken: string,
): Promise<Result<MetaManagedPage[], AppError>> {
  const res = await graph<{
    data?: {
      id: string
      name?: string
      access_token?: string
      instagram_business_account?: { id: string; username?: string }
    }[]
  }>(
    '/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100',
    userToken,
    { method: 'GET' },
  )
  if (!res.ok) return err(failure(res.message))
  const pages: MetaManagedPage[] = []
  for (const page of res.body.data ?? []) {
    if (!page.access_token) continue
    pages.push({
      id: page.id,
      name: page.name ?? page.id,
      accessToken: page.access_token,
      instagram: page.instagram_business_account
        ? {
            id: page.instagram_business_account.id,
            username: page.instagram_business_account.username ?? null,
          }
        : null,
    })
  }
  return ok(pages)
}

/** Subscribes the app to the Page webhooks. Idempotent on Meta's side. */
export async function subscribePage(
  pageToken: string,
  pageId: string,
  fields: string[] = PAGE_SUBSCRIBED_FIELDS,
): Promise<Result<true, AppError>> {
  const res = await graph(`/${pageId}/subscribed_apps`, pageToken, {
    method: 'POST',
    body: JSON.stringify({ subscribed_fields: fields }),
  })
  if (!res.ok) return err(failure(res.message))
  return ok(true)
}

/** Public reply to a comment (Instagram `replies`, Facebook `comments`). */
export async function replyToComment(input: {
  channel: MetaSocialChannel
  commentId: string
  token: string
  text: string
}): Promise<Result<string, AppError>> {
  const edge = input.channel === 'INSTAGRAM' ? 'replies' : 'comments'
  const res = await graph<{ id?: string }>(
    `/${input.commentId}/${edge}`,
    input.token,
    { method: 'POST', body: JSON.stringify({ message: input.text }) },
  )
  if (!res.ok) return err(failure(res.message))
  if (!res.body.id) return err(failure('A Meta não confirmou a resposta'))
  return ok(res.body.id)
}

/** Private reply (DM) to the author of a comment, one per comment. */
export async function sendPrivateReply(input: {
  pageId: string
  commentId: string
  token: string
  text: string
}): Promise<Result<string, AppError>> {
  const res = await graph<{ message_id?: string }>(
    `/${input.pageId}/messages`,
    input.token,
    {
      method: 'POST',
      body: JSON.stringify({
        recipient: { comment_id: input.commentId },
        message: { text: input.text },
      }),
    },
  )
  if (!res.ok) return err(failure(res.message))
  if (!res.body.message_id) return err(failure('A Meta não confirmou o envio'))
  return ok(res.body.message_id)
}

/** Display name of a customer who wrote in; null when Meta hides it. */
export async function fetchSocialProfile(
  channel: MetaSocialChannel,
  contactId: string,
  token: string,
): Promise<{ name: string | null; avatarUrl: string | null }> {
  const fields =
    channel === 'INSTAGRAM' ? 'name,username,profile_pic' : 'name,profile_pic'
  const res = await graph<{
    name?: string
    username?: string
    profile_pic?: string
  }>(`/${contactId}?fields=${fields}`, token, { method: 'GET' })
  if (!res.ok) return { name: null, avatarUrl: null }
  return {
    name: res.body.name ?? res.body.username ?? null,
    avatarUrl: res.body.profile_pic ?? null,
  }
}

// ─── Provider client ──────────────────────────────────────────────────────

const UNSUPPORTED = 'Este recurso não está disponível no Instagram e Messenger'

function unsupported(): never {
  throw new Error(UNSUPPORTED)
}

const MEDIA_TYPE: Record<WhatsAppOutboundMedia['type'], string> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  document: 'file',
}

/**
 * `WhatsAppProviderClient` of a social connection, so the inbox, the AI
 * auto-reply and the SLA use the same send path as WhatsApp. Only text and
 * media exist on these channels; the rest throws a pt-BR error that
 * `withProvider` turns into `WHATSAPP_PROVIDER_ERROR`.
 */
export function createMetaSocialClient(credentials: {
  pageId: string
  accessToken: string
}): WhatsAppProviderClient {
  const send = async (
    to: string,
    message: Record<string, unknown>,
  ): Promise<WhatsAppSendResult> => {
    const recipient = parseSocialWaId(to)?.id ?? to
    const res = await graph<{ message_id?: string }>(
      `/${credentials.pageId}/messages`,
      credentials.accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          recipient: { id: recipient },
          messaging_type: 'RESPONSE',
          message,
        }),
      },
    )
    if (!res.ok) throw new Error(res.message)
    if (!res.body.message_id) throw new Error('A Meta não confirmou o envio')
    return { providerMessageId: res.body.message_id }
  }

  return {
    sendText: ({ to, text }) => send(to, { text }),
    sendMedia: async ({ to, mediaUrl, type, caption }) => {
      const sent = await send(to, {
        attachment: {
          type: MEDIA_TYPE[type],
          payload: { url: mediaUrl, is_reusable: false },
        },
      })
      // Attachments carry no caption on these channels: send it as text.
      if (caption) await send(to, { text: caption })
      return sent
    },
    sendTemplate: async () => unsupported(),
    sendContact: async () => unsupported(),
    sendButtons: async () => unsupported(),
    sendReaction: async () => unsupported(),
    getConnectionStatus: async () => {
      const res = await graph(
        `/${credentials.pageId}?fields=id`,
        credentials.accessToken,
        { method: 'GET' },
      )
      return res.ok
        ? { connected: true, error: null }
        : { connected: false, failed: true, error: res.message }
    },
  }
}
