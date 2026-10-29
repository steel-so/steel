import 'server-only'
import { logger } from '@/lib/axiom/logger'
import type {
  WhatsAppOutboundButtons,
  WhatsAppOutboundContact,
  WhatsAppOutboundMedia,
  WhatsAppOutboundReaction,
  WhatsAppOutboundTemplate,
  WhatsAppOutboundText,
  WhatsAppProviderClient,
  WhatsAppSendResult,
} from './types'

const META_GRAPH_VERSION = 'v26.0'
export const META_GRAPH_BASE_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}`

export interface MetaCredentials {
  phoneNumberId: string
  wabaId: string
  accessToken: string
}

export async function metaRequest<T>(
  credentials: MetaCredentials,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${META_GRAPH_BASE_URL}${path}`
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${credentials.accessToken}`,
      ...init?.headers,
    },
  })

  const body = await response.json().catch(() => null)

  if (!response.ok) {
    logger.error('whatsapp.meta.request_failed', {
      path,
      status: response.status,
      body,
    })
    // 131062: this message type cannot go to a BSUID recipient.
    if (body?.error?.code === 131062) {
      throw new Error(
        'Este tipo de mensagem não pode ser enviado a um contato sem telefone (usuário com username)',
      )
    }
    throw new Error(
      body?.error?.message ??
        `Falha na requisição Meta API (${response.status})`,
    )
  }

  return body as T
}

const PHONE_HEALTH_FIELDS =
  'display_phone_number,verified_name,status,code_verification_status,health_status'

interface MetaPhoneHealth {
  status?: string
  health_status?: {
    can_send_message?: string
    entities?: {
      can_send_message?: string
      errors?: { error_code?: number; error_description?: string }[]
    }[]
  }
}

/** Result of checking a number against the Graph API. */
export interface WhatsAppConnectionCheck {
  connected: boolean
  /** The check itself failed (bad token, Graph down, number blocked). */
  failed?: boolean
  /** pt-BR reason shown on the connection when it is not usable. */
  error?: string | null
}

/** pt-BR message for the Meta health error codes we know customers hit. */
const META_HEALTH_ERRORS: Record<number, string> = {
  141000:
    'O número não está registrado na Cloud API da Meta. Registre o número (ou reconecte pela Meta) e tente de novo.',
  141006:
    'A conta do WhatsApp Business está sem forma de pagamento. Cadastre uma no Gerenciador da Meta.',
  141008: 'A conta do WhatsApp Business está restrita pela Meta.',
}

/**
 * Turns the phone-number `status` and `health_status` into a usable /
 * not-usable verdict with a pt-BR reason.
 */
export function evaluateMetaPhoneHealth(
  phone: MetaPhoneHealth,
): WhatsAppConnectionCheck {
  const errors = (phone.health_status?.entities ?? []).flatMap(
    (entity) => entity.errors ?? [],
  )
  const known = errors.find(
    (e) => e.error_code !== undefined && META_HEALTH_ERRORS[e.error_code],
  )
  const reason = known?.error_code
    ? META_HEALTH_ERRORS[known.error_code]
    : (errors[0]?.error_description ?? null)
  const blocked = phone.health_status?.can_send_message === 'BLOCKED'
  const status = phone.status ?? 'UNKNOWN'

  if (
    blocked ||
    ['BANNED', 'RESTRICTED', 'FLAGGED', 'DELETED'].includes(status)
  ) {
    return {
      connected: false,
      failed: true,
      error: reason ?? `A Meta bloqueou o número (status ${status}).`,
    }
  }
  if (status === 'CONNECTED') return { connected: true, error: null }
  return {
    connected: false,
    error:
      reason ??
      'O número ainda não está ativo na Cloud API da Meta (aguardando registro ou verificação).',
  }
}

/** Body limit of an interactive message on the Cloud API. */
export const META_INTERACTIVE_BODY_MAX = 1024

/**
 * Interactive message for a quick reply with buttons. Reply buttons go as
 * `interactive.type=button`; a lone link as `cta_url`. Meta cannot mix reply
 * and link buttons outside templates, so links that don't fit are appended
 * to the body text (the UI says so).
 */
export function buildMetaInteractive(input: WhatsAppOutboundButtons): {
  interactive: Record<string, unknown>
  body: string
} {
  const replies = input.buttons.filter((b) => b.type === 'REPLY')
  const links = input.buttons.filter((b) => b.type === 'URL')
  const ctaLink = replies.length === 0 ? links[0] : undefined
  const appended = links.filter((link) => link !== ctaLink)
  const body = [
    input.text,
    ...appended.map((link) => `${link.label}: ${link.url}`),
  ].join('\n\n')
  const header = input.media
    ? {
        type: input.media.type,
        [input.media.type]: {
          link: input.media.url,
          ...(input.media.type === 'document' && input.media.fileName
            ? { filename: input.media.fileName }
            : {}),
        },
      }
    : undefined

  const interactive: Record<string, unknown> = ctaLink
    ? {
        type: 'cta_url',
        body: { text: body },
        action: {
          name: 'cta_url',
          parameters: { display_text: ctaLink.label, url: ctaLink.url },
        },
      }
    : {
        type: 'button',
        body: { text: body },
        action: {
          buttons: replies.map((reply) => ({
            type: 'reply',
            reply: { id: reply.id, title: reply.label },
          })),
        },
      }
  if (header) interactive.header = header
  return { interactive, body }
}

const PHONE_DIGITS = /^\d+$/

/**
 * Cloud API addressee: a phone number goes in `to`; anything else is a
 * business-scoped user ID (`BR.123…`, the contact has no phone for us) and
 * goes in `recipient`. Both can never be sent together (`to` would win).
 */
export function metaRecipient(
  address: string,
): { to: string } | { recipient: string } {
  return PHONE_DIGITS.test(address) ? { to: address } : { recipient: address }
}

export function createMetaClient(
  credentials: MetaCredentials,
): WhatsAppProviderClient {
  const messagesPath = `/${credentials.phoneNumberId}/messages`
  const marketingMessagesPath = `/${credentials.phoneNumberId}/marketing_messages`

  return {
    async sendText({
      to,
      text,
      quotedProviderMessageId,
    }: WhatsAppOutboundText): Promise<WhatsAppSendResult> {
      const result = await metaRequest<{ messages: { id: string }[] }>(
        credentials,
        messagesPath,
        {
          method: 'POST',
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            ...metaRecipient(to),
            type: 'text',
            text: { body: text },
            ...(quotedProviderMessageId
              ? { context: { message_id: quotedProviderMessageId } }
              : {}),
          }),
        },
      )
      return { providerMessageId: result.messages[0].id }
    },

    async sendMedia({
      to,
      mediaUrl,
      caption,
      type,
      fileName,
      quotedProviderMessageId,
    }: WhatsAppOutboundMedia): Promise<WhatsAppSendResult> {
      // Cloud API: áudio não aceita legenda; documento leva o nome do arquivo.
      const media = {
        link: mediaUrl,
        ...(caption && type !== 'audio' ? { caption } : {}),
        ...(fileName && type === 'document' ? { filename: fileName } : {}),
      }
      const result = await metaRequest<{ messages: { id: string }[] }>(
        credentials,
        messagesPath,
        {
          method: 'POST',
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            ...metaRecipient(to),
            type,
            [type]: media,
            ...(quotedProviderMessageId
              ? { context: { message_id: quotedProviderMessageId } }
              : {}),
          }),
        },
      )
      return { providerMessageId: result.messages[0].id }
    },

    async sendTemplate({
      to,
      templateName,
      language,
      components,
      marketingLite,
    }: WhatsAppOutboundTemplate): Promise<WhatsAppSendResult> {
      const result = await metaRequest<{ messages: { id: string }[] }>(
        credentials,
        marketingLite ? marketingMessagesPath : messagesPath,
        {
          method: 'POST',
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            ...metaRecipient(to),
            type: 'template',
            template: {
              name: templateName,
              language: { code: language },
              ...(components ? { components } : {}),
            },
            ...(marketingLite?.cloudApiFallback
              ? { product_policy: 'CLOUD_API_FALLBACK' }
              : {}),
          }),
        },
      )
      return { providerMessageId: result.messages[0].id }
    },

    async sendContact({
      to,
      name,
      waId,
    }: WhatsAppOutboundContact): Promise<WhatsAppSendResult> {
      const result = await metaRequest<{ messages: { id: string }[] }>(
        credentials,
        messagesPath,
        {
          method: 'POST',
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            ...metaRecipient(to),
            type: 'contacts',
            contacts: [
              {
                name: { formatted_name: name, first_name: name },
                phones: [{ phone: waId, type: 'CELL' }],
              },
            ],
          }),
        },
      )
      return { providerMessageId: result.messages[0].id }
    },

    async sendButtons(
      input: WhatsAppOutboundButtons,
    ): Promise<WhatsAppSendResult> {
      const { interactive, body } = buildMetaInteractive(input)
      if (body.length > META_INTERACTIVE_BODY_MAX) {
        throw new Error(
          `Mensagem com botões aceita até ${META_INTERACTIVE_BODY_MAX} caracteres na Meta`,
        )
      }
      const result = await metaRequest<{ messages: { id: string }[] }>(
        credentials,
        messagesPath,
        {
          method: 'POST',
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            ...metaRecipient(input.to),
            type: 'interactive',
            interactive,
          }),
        },
      )
      return { providerMessageId: result.messages[0].id }
    },

    async sendReaction({
      to,
      providerMessageId,
      emoji,
    }: WhatsAppOutboundReaction): Promise<void> {
      await metaRequest(credentials, messagesPath, {
        method: 'POST',
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          ...metaRecipient(to),
          type: 'reaction',
          reaction: { message_id: providerMessageId, emoji },
        }),
      })
    },

    async getConnectionStatus(): Promise<WhatsAppConnectionCheck> {
      try {
        const phone = await metaRequest<MetaPhoneHealth>(
          credentials,
          `/${credentials.phoneNumberId}?fields=${PHONE_HEALTH_FIELDS}`,
          { method: 'GET' },
        )
        return evaluateMetaPhoneHealth(phone)
      } catch (cause) {
        return {
          connected: false,
          failed: true,
          error: `Não foi possível validar o número na Meta: ${
            cause instanceof Error ? cause.message : 'erro desconhecido'
          }`,
        }
      }
    },
  }
}
