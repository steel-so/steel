import type {
  DocumentDeliveryChannel,
  DocumentRecipient,
  WhatsAppConnection,
} from '@prisma/client'
import { logger } from '@/lib/axiom/logger'
import { leadPhoneToWaId } from '@/src/lib/crm-cadence/merge'
import { formatDocumentDate } from '@/src/lib/documents/format'
import { sendDocumentSharedEmail } from '@/src/lib/mail/documents/send-document-emails'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { documentLinkUrl } from '@/src/mappers/document.mapper'
import { DocumentLookupRepository } from '@/src/repositories/document-lookup.repository'
import { DocumentRecipientRepository } from '@/src/repositories/document-recipient.repository'
import type { DocumentDeliveryDTO } from '@/types/document'
import {
  checkWhatsAppOptOut,
  WHATSAPP_OPT_OUT_UNVERIFIED_MESSAGE,
  WHATSAPP_OPTED_OUT_MESSAGE,
} from './whatsapp-opt-out'

/**
 * Delivery of a document to its recipients (ADR 0063): e-mail with the
 * personal link, WhatsApp text through a connected number of the workspace
 * (falls back to LINK and says so) or just the link to copy. Never fails the
 * send: every problem becomes a `delivered: false` with a pt-BR note.
 */

export interface DocumentDeliveryContext {
  workspaceId: string
  documentId: string
  documentTitle: string
  workspaceName: string
  senderName: string
  senderEmail: string | null
  validUntil: Date | null
  message?: string | null
}

export interface DocumentDeliveryOutcome {
  recipient: DocumentRecipient
  delivery: DocumentDeliveryDTO
}

const NO_CONNECTION =
  'Nenhum número de WhatsApp conectado na Comunicação: copie o link e envie você mesmo.'
const BAD_PHONE =
  'O telefone não serve para WhatsApp: copie o link e envie você mesmo.'
const WHATSAPP_FAILED =
  'O WhatsApp não entregou a mensagem: copie o link e envie você mesmo.'
const EMAIL_FAILED =
  'Não foi possível enviar o e-mail agora: copie o link e envie por outro canal.'

function whatsappText(
  ctx: DocumentDeliveryContext,
  recipient: DocumentRecipient,
): string {
  const lines = [
    `Olá, ${recipient.name}! ${ctx.senderName}, de ${ctx.workspaceName}, enviou o documento "${ctx.documentTitle}" para você.`,
  ]
  if (ctx.message) lines.push(ctx.message)
  if (ctx.validUntil) {
    lines.push(`Ele vale até ${formatDocumentDate(ctx.validUntil)}.`)
  }
  lines.push(documentLinkUrl(recipient.token))
  return lines.join('\n\n')
}

type Attempt = {
  channel: DocumentDeliveryChannel
  delivered: boolean
  message: string | null
}

async function sendEmail(
  ctx: DocumentDeliveryContext,
  recipient: DocumentRecipient,
): Promise<Attempt> {
  if (!recipient.email) {
    return { channel: 'LINK', delivered: false, message: EMAIL_FAILED }
  }
  try {
    await sendDocumentSharedEmail({
      to: recipient.email,
      replyTo: ctx.senderEmail,
      recipientName: recipient.name,
      senderName: ctx.senderName,
      workspaceName: ctx.workspaceName,
      documentTitle: ctx.documentTitle,
      documentUrl: documentLinkUrl(recipient.token),
      message: ctx.message ?? null,
      validUntil: ctx.validUntil ? formatDocumentDate(ctx.validUntil) : null,
    })
    return { channel: 'EMAIL', delivered: true, message: null }
  } catch (error) {
    logger.warn('documents.delivery.email_failed', {
      documentId: ctx.documentId,
      recipientId: recipient.id,
      message: error instanceof Error ? error.message : String(error),
    })
    return { channel: 'EMAIL', delivered: false, message: EMAIL_FAILED }
  }
}

async function sendWhatsApp(
  ctx: DocumentDeliveryContext,
  recipient: DocumentRecipient,
  connection: WhatsAppConnection | null,
): Promise<Attempt> {
  if (!connection) {
    return { channel: 'LINK', delivered: false, message: NO_CONNECTION }
  }
  const waId = recipient.phone ? leadPhoneToWaId(recipient.phone) : null
  if (!waId) return { channel: 'LINK', delivered: false, message: BAD_PHONE }
  const optOut = await checkWhatsAppOptOut(ctx.workspaceId, waId)
  if (optOut !== 'allowed') {
    logger.info('documents.delivery.whatsapp_skipped', {
      documentId: ctx.documentId,
      recipientId: recipient.id,
      reason: optOut,
    })
    return {
      channel: 'LINK',
      delivered: false,
      message:
        optOut === 'opted_out'
          ? WHATSAPP_OPTED_OUT_MESSAGE
          : WHATSAPP_OPT_OUT_UNVERIFIED_MESSAGE,
    }
  }
  const sent = await WhatsAppSend.text(
    connection,
    { to: waId, text: whatsappText(ctx, recipient) },
    { cost: { source: 'OTHER' } },
  )
  if (!sent.ok) {
    logger.warn('documents.delivery.whatsapp_failed', {
      documentId: ctx.documentId,
      recipientId: recipient.id,
      code: sent.error.code,
    })
    return { channel: 'LINK', delivered: false, message: WHATSAPP_FAILED }
  }
  return { channel: 'WHATSAPP', delivered: true, message: null }
}

export async function deliverDocument(
  ctx: DocumentDeliveryContext,
  recipients: DocumentRecipient[],
  at: Date,
): Promise<DocumentDeliveryOutcome[]> {
  let connection: WhatsAppConnection | null = null
  if (recipients.some((recipient) => recipient.channel === 'WHATSAPP')) {
    const found = await DocumentLookupRepository.findConnectedWhatsApp(
      ctx.workspaceId,
    )
    connection = found.ok ? found.value : null
  }

  const outcomes: DocumentDeliveryOutcome[] = []
  for (const recipient of recipients) {
    let attempt: Attempt
    if (recipient.channel === 'EMAIL') {
      attempt = await sendEmail(ctx, recipient)
    } else if (recipient.channel === 'WHATSAPP') {
      attempt = await sendWhatsApp(ctx, recipient, connection)
    } else {
      attempt = { channel: 'LINK', delivered: true, message: null }
    }

    const marked = await DocumentRecipientRepository.markSent(recipient.id, {
      at,
      channel: attempt.channel,
    })
    outcomes.push({
      recipient: marked.ok ? marked.value : recipient,
      delivery: {
        recipientId: recipient.id,
        requested: recipient.channel,
        channel: attempt.channel,
        delivered: attempt.delivered,
        message: attempt.message,
      },
    })
  }
  return outcomes
}
