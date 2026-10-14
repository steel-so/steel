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

const META_GRAPH_VERSION = 'v23.0'
const META_GRAPH_BASE_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}`

export interface MetaCredentials {
  phoneNumberId: string
  wabaId: string
  accessToken: string
}

async function metaRequest<T>(
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
    throw new Error(
      body?.error?.message ??
        `Falha na requisição Meta API (${response.status})`,
    )
  }

  return body as T
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

export function createMetaClient(
  credentials: MetaCredentials,
): WhatsAppProviderClient {
  const messagesPath = `/${credentials.phoneNumberId}/messages`

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
            to,
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
            to,
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
    }: WhatsAppOutboundTemplate): Promise<WhatsAppSendResult> {
      const result = await metaRequest<{ messages: { id: string }[] }>(
        credentials,
        messagesPath,
        {
          method: 'POST',
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to,
            type: 'template',
            template: {
              name: templateName,
              language: { code: language },
              ...(components ? { components } : {}),
            },
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
            to,
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
            to: input.to,
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
          to,
          type: 'reaction',
          reaction: { message_id: providerMessageId, emoji },
        }),
      })
    },

    async getConnectionStatus(): Promise<{ connected: boolean }> {
      try {
        await metaRequest(credentials, `/${credentials.phoneNumberId}`, {
          method: 'GET',
        })
        return { connected: true }
      } catch {
        return { connected: false }
      }
    },
  }
}
