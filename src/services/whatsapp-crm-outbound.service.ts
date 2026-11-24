import type { WhatsAppMessageType } from '@prisma/client'
import { logger } from '@/lib/axiom/logger'
import { ok, type Result } from '@/src/lib/result'
import { WhatsAppCrmOutboundRepository } from '@/src/repositories/whatsapp-crm-outbound.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'

/** How long a CRM message waits for the contact's reply to be filed with it. */
export const CRM_OUTBOUND_WINDOW_DAYS = 14
const MAX_PER_REPLY = 10
const MAX_TEXT = 4000

/** What a sender fills in while it builds the message, to log it afterwards. */
export interface SentCapture {
  text?: string
  type?: WhatsAppMessageType
}

export type CrmOutboundSource =
  | 'campaign'
  | 'cadence'
  | 'workflow'
  | 'newsletter'

/**
 * Logs a WhatsApp message the CRM just sent through the provider. When the
 * contact answers, the webhook files it in the conversation (see
 * `fileCrmOutboundInConversation`), so people and the AI read the reply with
 * what it answers. Best effort: never fails the send that already happened.
 */
export async function recordCrmOutbound(input: {
  workspaceId: string
  waId: string
  source: CrmOutboundSource
  type?: WhatsAppMessageType
  text: string | null | undefined
  providerMessageId?: string | null
}): Promise<void> {
  const text = input.text?.trim()
  if (!text) return
  const saved = await WhatsAppCrmOutboundRepository.create({
    workspaceId: input.workspaceId,
    waId: input.waId,
    source: input.source,
    type: input.type ?? 'TEXT',
    text: text.slice(0, MAX_TEXT),
    providerMessageId: input.providerMessageId ?? null,
  })
  if (!saved.ok) {
    logger.warn('whatsapp.crm_outbound.record_failed', {
      workspaceId: input.workspaceId,
      source: input.source,
      reason: saved.error.code,
    })
  }
}

/**
 * The contact answered: files the CRM messages that were waiting for this
 * number as outbound messages of the conversation, at the time they were
 * sent. Best effort — a failure is logged and the inbound flow goes on.
 */
export async function fileCrmOutboundInConversation(input: {
  workspaceId: string
  waId: string
  conversationId: string
  now?: Date
}): Promise<Result<number>> {
  const now = input.now ?? new Date()
  const since = new Date(now.getTime() - CRM_OUTBOUND_WINDOW_DAYS * 86_400_000)
  const pending = await WhatsAppCrmOutboundRepository.listPending(
    input.workspaceId,
    input.waId,
    since,
    MAX_PER_REPLY,
  )
  if (!pending.ok || pending.value.length === 0) return ok(0)

  const filed: string[] = []
  for (const row of pending.value) {
    const created = await WhatsAppMessageRepository.create({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      direction: 'OUT',
      type: row.type,
      text: row.text,
      providerMessageId: row.providerMessageId ?? undefined,
      status: 'SENT',
      createdAt: row.sentAt,
    })
    if (created.ok) filed.push(row.id)
    else {
      logger.warn('whatsapp.crm_outbound.file_failed', {
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        reason: created.error.code,
      })
    }
  }
  if (filed.length > 0) {
    await WhatsAppCrmOutboundRepository.markImported(filed, now)
  }
  return ok(filed.length)
}
