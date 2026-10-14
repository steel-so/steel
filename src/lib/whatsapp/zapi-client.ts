import 'server-only'
import { logger } from '@/lib/axiom/logger'
import type {
  WhatsAppOutboundButtons,
  WhatsAppOutboundContact,
  WhatsAppOutboundMedia,
  WhatsAppOutboundReaction,
  WhatsAppOutboundText,
  WhatsAppQrCode,
  WhatsAppSendResult,
  ZapiProviderClient,
} from './types'

const ZAPI_BASE_URL = 'https://api.z-api.io'

export interface ZapiCredentials {
  instanceId: string
  token: string
  clientToken?: string
}

export async function zapiRequest<T>(
  credentials: ZapiCredentials,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${ZAPI_BASE_URL}/instances/${credentials.instanceId}/token/${credentials.token}${path}`
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(credentials.clientToken
        ? { 'Client-Token': credentials.clientToken }
        : {}),
      ...init?.headers,
    },
  })

  const body = await response.json().catch(() => null)

  if (!response.ok) {
    logger.error('whatsapp.zapi.request_failed', {
      path,
      status: response.status,
      body,
    })
    throw new Error(zapiErrorMessage(body, response.status))
  }

  return body as T
}

/**
 * pt-BR message for a failed Z-API call. Z-API reports the reason in `error`
 * (not `message`), and the most common one — the account's security token
 * not sent — gets an actionable explanation.
 */
export function zapiErrorMessage(body: unknown, status: number): string {
  const payload =
    body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const reason =
    typeof payload.error === 'string'
      ? payload.error
      : typeof payload.message === 'string'
        ? payload.message
        : null
  if (reason && /client-token/i.test(reason)) {
    return 'A Z-API recusou a chamada: o Client-Token (token de segurança da conta) não foi informado ou está errado. Preencha o Client-Token na conexão.'
  }
  return reason
    ? `A Z-API recusou a chamada (${status}): ${reason}`
    : `Falha na requisição Z-API (${status})`
}

const MEDIA_ENDPOINT_BY_TYPE: Record<WhatsAppOutboundMedia['type'], string> = {
  image: '/send-image',
  audio: '/send-audio',
  video: '/send-video',
  document: '/send-document',
}

const MEDIA_PAYLOAD_KEY_BY_TYPE: Record<WhatsAppOutboundMedia['type'], string> =
  {
    image: 'image',
    audio: 'audio',
    video: 'video',
    document: 'document',
  }

/** Extensão do documento (a Z-API exige em `/send-document/{extensão}`). */
function documentExtension(fileName?: string, mediaUrl?: string): string {
  for (const source of [fileName, mediaUrl]) {
    const path = source?.split(/[?#]/)[0] ?? ''
    const last = path.split('/').pop() ?? ''
    const dot = last.lastIndexOf('.')
    if (dot > 0 && dot < last.length - 1) {
      const ext = last.slice(dot + 1).toLowerCase()
      if (/^[a-z0-9]{1,8}$/.test(ext) && ext !== 'bin') return ext
    }
  }
  return 'pdf'
}

/**
 * Z-API request for a message with buttons. Only reply buttons and no media:
 * `/send-button-list`; anything else (a link, an image): `/send-button-actions`
 * (REPLY and URL mixed — CALL never). Video/document media is not supported
 * by the button endpoints: the caller sends it first as its own message.
 */
export function buildZapiButtons(input: WhatsAppOutboundButtons): {
  path: string
  body: Record<string, unknown>
} {
  const image = input.media?.type === 'image' ? input.media.url : undefined
  const onlyReplies = input.buttons.every((b) => b.type === 'REPLY')
  if (onlyReplies && !image) {
    return {
      path: '/send-button-list',
      body: {
        phone: input.to,
        message: input.text,
        buttonList: {
          buttons: input.buttons.map((b) => ({ id: b.id, label: b.label })),
        },
      },
    }
  }
  return {
    path: '/send-button-actions',
    body: {
      phone: input.to,
      message: input.text,
      ...(image ? { image } : {}),
      buttonActions: input.buttons.map((b) =>
        b.type === 'URL'
          ? { id: b.id, type: 'URL', label: b.label, url: b.url }
          : { id: b.id, type: 'REPLY', label: b.label },
      ),
    },
  }
}

export function createZapiClient(
  credentials: ZapiCredentials,
): ZapiProviderClient {
  return {
    async sendText({
      to,
      text,
      quotedProviderMessageId,
      mentionedWaIds,
    }: WhatsAppOutboundText): Promise<WhatsAppSendResult> {
      const result = await zapiRequest<{ messageId: string }>(
        credentials,
        '/send-text',
        {
          method: 'POST',
          body: JSON.stringify({
            phone: to,
            message: text,
            ...(quotedProviderMessageId
              ? { messageId: quotedProviderMessageId }
              : {}),
            ...(mentionedWaIds?.length ? { mentioned: mentionedWaIds } : {}),
          }),
        },
      )
      return { providerMessageId: result.messageId }
    },

    async sendMedia({
      to,
      mediaUrl,
      caption,
      type,
      fileName,
      quotedProviderMessageId,
    }: WhatsAppOutboundMedia): Promise<WhatsAppSendResult> {
      const endpoint =
        type === 'document'
          ? `${MEDIA_ENDPOINT_BY_TYPE.document}/${documentExtension(fileName, mediaUrl)}`
          : MEDIA_ENDPOINT_BY_TYPE[type]
      const result = await zapiRequest<{ messageId: string }>(
        credentials,
        endpoint,
        {
          method: 'POST',
          body: JSON.stringify({
            phone: to,
            [MEDIA_PAYLOAD_KEY_BY_TYPE[type]]: mediaUrl,
            // Áudio não tem legenda na Z-API.
            ...(caption && type !== 'audio' ? { caption } : {}),
            ...(fileName ? { fileName } : {}),
            ...(quotedProviderMessageId
              ? { messageId: quotedProviderMessageId }
              : {}),
          }),
        },
      )
      return { providerMessageId: result.messageId }
    },

    async sendTemplate(): Promise<WhatsAppSendResult> {
      throw new Error('Z-API não suporta templates de mensagem da Meta')
    },

    async sendContact({
      to,
      name,
      waId,
    }: WhatsAppOutboundContact): Promise<WhatsAppSendResult> {
      const result = await zapiRequest<{ messageId: string }>(
        credentials,
        '/send-contact',
        {
          method: 'POST',
          body: JSON.stringify({
            phone: to,
            contactName: name,
            contactPhone: waId,
          }),
        },
      )
      return { providerMessageId: result.messageId }
    },

    async sendButtons(
      input: WhatsAppOutboundButtons,
    ): Promise<WhatsAppSendResult> {
      const { path, body } = buildZapiButtons(input)
      const result = await zapiRequest<{ messageId: string }>(
        credentials,
        path,
        { method: 'POST', body: JSON.stringify(body) },
      )
      return { providerMessageId: result.messageId }
    },

    async sendReaction({
      to,
      providerMessageId,
      emoji,
    }: WhatsAppOutboundReaction): Promise<void> {
      await zapiRequest(credentials, '/send-reaction', {
        method: 'POST',
        body: JSON.stringify({
          phone: to,
          messageId: providerMessageId,
          reaction: emoji,
        }),
      })
    },

    async getConnectionStatus(): Promise<{ connected: boolean }> {
      const result = await zapiRequest<{ connected: boolean }>(
        credentials,
        '/status',
      )
      return { connected: Boolean(result.connected) }
    },

    async getQrCode(): Promise<WhatsAppQrCode> {
      const status = await zapiRequest<{ connected: boolean }>(
        credentials,
        '/status',
      )
      if (status.connected) return { status: 'connected' }

      const qr = await zapiRequest<{ value: string }>(
        credentials,
        '/qr-code/image',
      )
      return { status: 'awaiting_scan', qrCodeBase64: qr.value }
    },
  }
}

export interface ZapiContactInfo {
  name?: string
  phone: string
  imgUrl?: string
  about?: string
}

// Z-API-only: basic profile info for a contact (name, "about" status, and a
// photo URL). Meta's Cloud API has no equivalent — it only exposes the
// business's own profile, never an arbitrary customer's. Useful for name/
// about, but don't rely on `imgUrl` here for a fresh photo — Z-API's own
// docs note it can be a link WhatsApp already expired; use
// getZapiContactProfilePicture for that.
export async function getZapiContactInfo(
  credentials: ZapiCredentials,
  phone: string,
): Promise<ZapiContactInfo | null> {
  const result = await zapiRequest<ZapiContactInfo | null>(
    credentials,
    `/contacts/${encodeURIComponent(phone)}`,
  )
  return result
}

// Z-API-only: returns a fresh (non-expired) URL for the contact's current
// WhatsApp profile photo. This is the endpoint Z-API's own docs point to
// specifically for refreshing a photo link once the one from
// getZapiContactInfo's imgUrl (valid ~48h) has gone stale — note the path is
// `/profile-picture`, not nested under `/contacts/`.
export async function getZapiContactProfilePicture(
  credentials: ZapiCredentials,
  phone: string,
): Promise<string | null> {
  const result = await zapiRequest<{ link?: string } | null>(
    credentials,
    `/profile-picture?phone=${encodeURIComponent(phone)}`,
  )
  return result?.link ?? null
}
