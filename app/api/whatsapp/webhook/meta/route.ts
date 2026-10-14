import { createHmac, timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import {
  WHATSAPP_META_APP_SECRET,
  WHATSAPP_META_VERIFY_TOKEN,
} from '@/lib/env/server'
import { consume, whatsappWebhookLimiter } from '@/src/lib/rate-limit'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { assertModuleEnabled } from '@/src/services/authz'
import {
  metaConnectionError,
  WhatsAppConnectionHealthService,
} from '@/src/services/whatsapp-connection-health.service'
import { WhatsAppTemplateService } from '@/src/services/whatsapp-template.service'
import { WhatsAppWebhookService } from '@/src/services/whatsapp-webhook.service'
import type { WhatsAppMessageTypeDTO } from '@/types/whatsapp-message'
import { parseJson } from '@/utils/http-request'

function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  if (!WHATSAPP_META_APP_SECRET) return false
  if (!signatureHeader?.startsWith('sha256=')) return false

  const expected = createHmac('sha256', WHATSAPP_META_APP_SECRET)
    .update(rawBody, 'utf8')
    .digest('hex')
  const provided = signatureHeader.slice('sha256='.length)

  if (expected.length !== provided.length) return false
  return timingSafeEqual(Buffer.from(expected), Buffer.from(provided))
}

interface MetaMessage {
  id?: string
  from?: string
  type?: string
  text?: { body?: string }
  image?: { id?: string; caption?: string }
  video?: { id?: string; caption?: string }
  audio?: { id?: string }
  voice?: { id?: string }
  document?: { id?: string; filename?: string }
  sticker?: unknown
  location?: unknown
  reaction?: { message_id?: string; emoji?: string }
  button?: { text?: string; payload?: string }
  interactive?: {
    type?: string
    button_reply?: { id?: string; title?: string }
    list_reply?: { id?: string; title?: string }
  }
  contacts?: {
    name?: { formatted_name?: string }
    phones?: { phone?: string; wa_id?: string }[]
  }[]
  // Present when this message is a reply/quote to another one.
  context?: { id?: string }
}

interface MetaWebhookValue {
  // Template webhooks (message_template_status_update / _quality_update).
  event?: string
  reason?: string | null
  new_quality_score?: string
  message_template_name?: string
  message_template_language?: string
  metadata?: { phone_number_id?: string }
  contacts?: { wa_id?: string; profile?: { name?: string } }[]
  messages?: MetaMessage[]
  statuses?: {
    id?: string
    status?: string
    errors?: { code?: number; title?: string; message?: string }[]
  }[]
}

function extractMessageContent(message: MetaMessage): {
  type: WhatsAppMessageTypeDTO
  text?: string
  rawMediaUrl?: string
  contactPayload?: { name: string; waId: string }
  buttonPayload?: string
} {
  switch (message.type) {
    case 'text':
      return { type: 'TEXT', text: message.text?.body }
    case 'image':
      return {
        type: 'IMAGE',
        text: message.image?.caption,
        rawMediaUrl: message.image?.id,
      }
    case 'video':
      return {
        type: 'VIDEO',
        text: message.video?.caption,
        rawMediaUrl: message.video?.id,
      }
    case 'document':
      return {
        type: 'DOCUMENT',
        text: message.document?.filename,
        rawMediaUrl: message.document?.id,
      }
    case 'audio':
    case 'voice':
      return {
        type: 'AUDIO',
        rawMediaUrl: message.audio?.id ?? message.voice?.id,
      }
    case 'sticker':
      return { type: 'STICKER' }
    case 'location':
      return { type: 'LOCATION' }
    // Template quick-reply button: `payload` is what we sent with it.
    case 'button':
      return {
        type: 'BUTTON',
        text: message.button?.text,
        buttonPayload: message.button?.payload,
      }
    // Interactive reply button / list row: `id` is our payload.
    case 'interactive':
      return {
        type: 'BUTTON',
        text:
          message.interactive?.button_reply?.title ??
          message.interactive?.list_reply?.title,
        buttonPayload:
          message.interactive?.button_reply?.id ??
          message.interactive?.list_reply?.id,
      }
    case 'contacts': {
      const shared = message.contacts?.[0]
      const waId = shared?.phones?.[0]?.wa_id ?? shared?.phones?.[0]?.phone
      if (!shared || !waId) return { type: 'TEXT', text: '[Contato]' }
      return {
        type: 'CONTACT',
        contactPayload: {
          name: shared.name?.formatted_name ?? waId,
          waId: waId.replace(/\D/g, ''),
        },
      }
    }
    default:
      return { type: 'TEXT', text: `[Mensagem não suportada: ${message.type}]` }
  }
}

const META_STATUS_MAP: Record<
  string,
  'SENT' | 'DELIVERED' | 'READ' | 'FAILED'
> = {
  sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'READ',
  failed: 'FAILED',
}

export const GET = withAxiom(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (
    mode === 'subscribe' &&
    token &&
    WHATSAPP_META_VERIFY_TOKEN &&
    token === WHATSAPP_META_VERIFY_TOKEN
  ) {
    return new Response(challenge ?? '', { status: 200 })
  }

  return new Response('Token inválido', { status: 403 })
})

export const POST = withAxiom(async (request: NextRequest) => {
  const rawBody = await request.text()

  if (
    !verifyMetaSignature(rawBody, request.headers.get('x-hub-signature-256'))
  ) {
    return new Response('Assinatura inválida', { status: 401 })
  }

  // Parse só depois de verificar a assinatura sobre o corpo bruto.
  const parsedBody = parseJson(rawBody)
  if (!parsedBody.ok) {
    return new Response('Entrada inválida', { status: 400 })
  }
  const json = parsedBody.value as {
    entry?: {
      id?: string
      changes?: { field?: string; value?: MetaWebhookValue }[]
    }[]
  } | null

  const entry = json?.entry?.[0]
  const change = entry?.changes?.[0]
  const value = change?.value

  if (!value) {
    return new Response('Entrada inválida', { status: 400 })
  }

  // Template review/quality changes come per WABA (`entry.id`), with no
  // phone number: they update the stored template and warn the admins.
  if (
    change.field === 'message_template_status_update' ||
    change.field === 'message_template_quality_update'
  ) {
    if (!entry?.id) return new Response('SEM_WABA_ID', { status: 200 })
    const applied = await WhatsAppTemplateService.applyWebhookUpdate({
      wabaId: entry.id,
      field: change.field,
      value,
    })
    if (!applied.ok) {
      return new Response('Erro interno', { status: 500 })
    }
    return new Response('TEMPLATE_UPDATE_RECEIVED', { status: 200 })
  }

  const phoneNumberId = value.metadata?.phone_number_id
  if (!phoneNumberId) {
    return new Response('SEM_PHONE_NUMBER_ID', { status: 200 })
  }

  const connectionResult =
    await WhatsAppConnectionRepository.findByMetaPhoneNumberId(phoneNumberId)
  if (!connectionResult.ok) {
    return new Response('Erro interno', { status: 500 })
  }
  const connection = connectionResult.value
  if (!connection) {
    return new Response('Número não encontrado', { status: 404 })
  }

  // Webhook público: a workspace vem da conexão, e o módulo dono dela
  // (Comunicação ou ServiceDesk) precisa estar habilitado — senão nada é
  // ingerido. Conexões do ServiceDesk funcionam sem o módulo Comunicação.
  const moduleEnabled = await assertModuleEnabled(
    connection.workspaceId,
    connection.module,
  )
  if (!moduleEnabled.ok) {
    return new Response('Módulo desabilitado', { status: 403 })
  }

  const limit = await consume(whatsappWebhookLimiter, connection.id)
  if (!limit.ok) {
    return new Response('Muitas requisições', { status: 429 })
  }

  const status = value.statuses?.[0]
  // A failure that says the number itself stopped working (token expired,
  // account restricted…) takes the connection down — once per transition.
  if (status?.status === 'failed') {
    const problem = metaConnectionError(status.errors)
    if (problem) {
      await WhatsAppConnectionHealthService.markDown(connection, {
        status: 'ERROR',
        error: problem,
        source: 'meta_webhook',
      })
    }
  }
  if (status?.id && status.status) {
    const mapped = META_STATUS_MAP[status.status]
    if (mapped) {
      await WhatsAppWebhookService.ingestStatusUpdate({
        providerMessageId: status.id,
        status: mapped,
        module: connection.module,
      })
    }
    return new Response('STATUS_RECEIVED', { status: 200 })
  }

  const message = value.messages?.[0]
  if (!message?.id || !message.from) {
    return new Response('SEM_MENSAGEM', { status: 200 })
  }

  if (message.type === 'reaction') {
    if (message.reaction?.message_id) {
      await WhatsAppWebhookService.ingestInboundReaction({
        providerMessageId: message.reaction.message_id,
        emoji: message.reaction.emoji ?? '',
        module: connection.module,
      })
    }
    return new Response('REACTION_RECEIVED', { status: 200 })
  }

  const waId = message.from.replace(/\D/g, '')
  const contactName = value.contacts?.[0]?.profile?.name
  const content = extractMessageContent(message)

  const result = await WhatsAppWebhookService.ingestInboundMessage({
    connection,
    waId,
    contactName,
    providerMessageId: message.id,
    quotedProviderMessageId: message.context?.id,
    ...content,
  })
  if (!result.ok) {
    return new Response('Erro ao processar mensagem', { status: 500 })
  }

  return new Response('EVENT_RECEIVED', { status: 200 })
})
