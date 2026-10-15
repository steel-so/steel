import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { consume, whatsappWebhookLimiter } from '@/src/lib/rate-limit'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { assertModuleEnabled } from '@/src/services/authz'
import { WhatsAppConnectionHealthService } from '@/src/services/whatsapp-connection-health.service'
import { WhatsAppWebhookService } from '@/src/services/whatsapp-webhook.service'
import type { WhatsAppMessageTypeDTO } from '@/types/whatsapp-message'

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

interface ZapiPayload {
  instanceId?: string
  type?: string
  phone?: string
  senderName?: string
  senderPhoto?: string
  messageId?: string
  fromMe?: boolean
  status?: string
  isGroup?: boolean
  participantPhone?: string
  chatName?: string
  text?: { message?: string }
  image?: { imageUrl?: string; caption?: string }
  audio?: { audioUrl?: string }
  video?: { videoUrl?: string; caption?: string }
  document?: { documentUrl?: string; filename?: string }
  sticker?: unknown
  location?: unknown
  reaction?: { value?: string; referencedMessage?: { messageId?: string } }
  contact?: { displayName?: string; vcard?: string }
  // Click on a button we sent (`buttonId` = our payload).
  buttonsResponseMessage?: { buttonId?: string; message?: string }
  listResponseMessage?: {
    message?: string
    title?: string
    selectedRowId?: string
  }
  // Present on the payload when this message is a reply/quote to another one.
  referenceMessageId?: string
  // DisconnectedCallback: why the instance dropped.
  error?: string
}

function waIdFromVcard(vcard: string | undefined): string | undefined {
  const match = vcard?.match(/waid=(\d+)/)
  return match?.[1]
}

function extractMessageContent(payload: ZapiPayload): {
  type: WhatsAppMessageTypeDTO
  text?: string
  rawMediaUrl?: string
  contactPayload?: { name: string; waId: string }
  buttonPayload?: string
} {
  if (payload.buttonsResponseMessage) {
    return {
      type: 'BUTTON',
      text: payload.buttonsResponseMessage.message,
      buttonPayload: payload.buttonsResponseMessage.buttonId,
    }
  }
  if (payload.listResponseMessage) {
    return {
      type: 'BUTTON',
      text:
        payload.listResponseMessage.title ??
        payload.listResponseMessage.message,
      buttonPayload: payload.listResponseMessage.selectedRowId,
    }
  }
  if (payload.contact) {
    const waId = waIdFromVcard(payload.contact.vcard)
    if (waId) {
      return {
        type: 'CONTACT',
        contactPayload: {
          name: payload.contact.displayName ?? waId,
          waId,
        },
      }
    }
  }
  if (payload.text?.message !== undefined) {
    return { type: 'TEXT', text: payload.text.message }
  }
  if (payload.image?.imageUrl) {
    return {
      type: 'IMAGE',
      text: payload.image.caption,
      rawMediaUrl: payload.image.imageUrl,
    }
  }
  if (payload.audio?.audioUrl) {
    return { type: 'AUDIO', rawMediaUrl: payload.audio.audioUrl }
  }
  if (payload.video?.videoUrl) {
    return {
      type: 'VIDEO',
      text: payload.video.caption,
      rawMediaUrl: payload.video.videoUrl,
    }
  }
  if (payload.document?.documentUrl) {
    return {
      type: 'DOCUMENT',
      text: payload.document.filename,
      rawMediaUrl: payload.document.documentUrl,
    }
  }
  if (payload.sticker) return { type: 'STICKER' }
  if (payload.location) return { type: 'LOCATION' }
  return { type: 'TEXT', text: '' }
}

const ZAPI_STATUS_MAP: Record<string, 'SENT' | 'DELIVERED' | 'READ'> = {
  SENT: 'SENT',
  RECEIVED: 'DELIVERED',
  READ: 'READ',
  PLAYED: 'READ',
}

export const GET = withAxiom(async () => {
  return new Response('OK', { status: 200 })
})

export const POST = withAxiom(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url)
  const secret = searchParams.get('secret') ?? ''

  const body = (await request.json().catch(() => null)) as ZapiPayload | null
  if (!body?.instanceId || !body.type) {
    return new Response('Dados incompletos', { status: 400 })
  }

  const connectionResult =
    await WhatsAppConnectionRepository.findByZapiInstanceId(body.instanceId)
  if (!connectionResult.ok) {
    return new Response('Erro interno', { status: 500 })
  }
  const connection = connectionResult.value
  if (!connection) {
    return new Response('Instância não encontrada', { status: 404 })
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

  if (!secret || !constantTimeEqual(secret, connection.webhookSecret)) {
    return new Response('Assinatura inválida', { status: 401 })
  }

  const limit = await consume(whatsappWebhookLimiter, connection.id)
  if (!limit.ok) {
    return new Response('Muitas requisições', { status: 429 })
  }

  if (body.type === 'StatusCallback') {
    const mapped = ZAPI_STATUS_MAP[body.status ?? '']
    if (mapped && body.messageId) {
      await WhatsAppWebhookService.ingestStatusUpdate({
        providerMessageId: body.messageId,
        status: mapped,
        module: connection.module,
      })
    }
    return new Response('STATUS_RECEIVED', { status: 200 })
  }

  // Instance lost/regained the phone session: the admins hear about a drop
  // once per transition (the health service ignores repeats).
  if (body.type === 'DisconnectedCallback') {
    await WhatsAppConnectionHealthService.markDown(connection, {
      status: 'DISCONNECTED',
      error: body.error ?? null,
      source: 'zapi_webhook',
    })
    return new Response('DISCONNECTED_RECEIVED', { status: 200 })
  }
  if (body.type === 'ConnectedCallback') {
    await WhatsAppConnectionHealthService.markUp(connection)
    return new Response('CONNECTED_RECEIVED', { status: 200 })
  }

  if (body.type !== 'ReceivedCallback') {
    return new Response('IGNORED', { status: 200 })
  }

  const referencedMessageId = body.reaction?.referencedMessage?.messageId
  if (referencedMessageId) {
    await WhatsAppWebhookService.ingestInboundReaction({
      providerMessageId: referencedMessageId,
      emoji: body.reaction?.value ?? '',
      module: connection.module,
    })
    return new Response('REACTION_RECEIVED', { status: 200 })
  }

  if (body.isGroup) {
    const groupJid = body.phone
    // Grupos são do zap: a conexão do ServiceDesk atende só conversas 1:1.
    if (
      !groupJid ||
      !body.messageId ||
      body.fromMe ||
      connection.module !== 'COMMUNICATION'
    ) {
      return new Response('IGNORED', { status: 200 })
    }
    const content = extractMessageContent(body)
    if (content.type === 'CONTACT') {
      return new Response('IGNORED', { status: 200 })
    }
    await WhatsAppWebhookService.ingestInboundGroupMessage({
      connection,
      groupJid,
      groupName: body.chatName,
      senderWaId: (body.participantPhone ?? '').replace(/\D/g, ''),
      senderName: body.senderName,
      providerMessageId: body.messageId,
      ...content,
    })
    return new Response('GROUP_MESSAGE_RECEIVED', { status: 200 })
  }

  const waId = (body.phone ?? '').replace(/\D/g, '')
  if (!waId || !body.messageId) {
    return new Response('IGNORED', { status: 200 })
  }

  const content = extractMessageContent(body)

  // fromMe=true covers two cases Z-API can't distinguish for us: an echo of
  // a message the platform itself sent (already persisted, so the dedupe by
  // providerMessageId below is a no-op) and one the agent sent directly from
  // the linked phone, which we do want to show up in the conversation.
  const result = body.fromMe
    ? await WhatsAppWebhookService.ingestOutboundDeviceMessage({
        connection,
        waId,
        contactName: body.senderName,
        contactAvatarUrl: body.senderPhoto,
        providerMessageId: body.messageId,
        quotedProviderMessageId: body.referenceMessageId,
        ...content,
      })
    : await WhatsAppWebhookService.ingestInboundMessage({
        connection,
        waId,
        contactName: body.senderName,
        contactAvatarUrl: body.senderPhoto,
        providerMessageId: body.messageId,
        quotedProviderMessageId: body.referenceMessageId,
        ...content,
      })
  if (!result.ok) {
    return new Response('Erro ao processar mensagem', { status: 500 })
  }

  return new Response('EVENT_RECEIVED', { status: 200 })
})
