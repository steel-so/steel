import type {
  WhatsAppConnection,
  WhatsAppContact,
  WhatsAppMessageType,
  WhatsAppTemplate,
} from '@prisma/client'
import { logger } from '@/lib/axiom/logger'
import {
  whatsappConnectionNotFound,
  whatsappTemplateNotFound,
} from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { applyTemplateSendExtras } from '@/src/lib/whatsapp/template-send'
import { toWhatsAppConversationDTO } from '@/src/mappers/whatsapp-conversation.mapper'
import { toWhatsAppMessageDTO } from '@/src/mappers/whatsapp-message.mapper'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { WhatsAppTemplateRepository } from '@/src/repositories/whatsapp-template.repository'
import { WhatsAppUsageService } from './whatsapp-usage.service'

/** Records an outbound message in a conversation and tells the open screens. */
export async function recordOutboundMessage(input: {
  workspaceId: string
  conversationId: string
  type: WhatsAppMessageType
  text: string
  providerMessageId: string
  senderUserId?: string | null
}): Promise<Result<void>> {
  const message = await WhatsAppMessageRepository.create({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    direction: 'OUT',
    type: input.type,
    text: input.text,
    providerMessageId: input.providerMessageId,
    status: 'SENT',
    senderUserId: input.senderUserId ?? undefined,
  })
  if (!message.ok) return message
  await WhatsAppConversationRepository.update(input.conversationId, {
    lastMessageAt: new Date(),
  })
  await publishWhatsAppEvent(input.workspaceId, {
    type: 'message.created',
    conversationId: input.conversationId,
    message: toWhatsAppMessageDTO(message.value),
  })
  const fresh = await WhatsAppConversationRepository.findById(
    input.conversationId,
    input.workspaceId,
  )
  if (fresh.ok && fresh.value) {
    await publishWhatsAppEvent(input.workspaceId, {
      type: 'conversation.updated',
      conversation: toWhatsAppConversationDTO(fresh.value),
    })
  }
  return ok(undefined)
}

export type AutomationSendOutcome =
  | { kind: 'sent'; conversationId: string; providerMessageId: string }
  | { kind: 'opted_out' }
  | { kind: 'not_ready'; reason: string }

/**
 * Sends an approved template to a phone on behalf of an automation (store
 * triggers, appointment messages) and files it in the contact's conversation.
 * Respects the LGPD opt-out and the connection state; the caller decides what
 * `not_ready` means (retry later, or skip).
 */
export async function sendAutomationTemplate(input: {
  workspaceId: string
  connectionId: string
  templateId: string
  waId: string
  contactName?: string | null
  /** Body variables in order (empty values become "-": Meta refuses them). */
  variables: string[]
  /** Skip the opt-out check: transactional appointment notices. */
  ignoreOptOut?: boolean
  costSource?: 'OTHER' | 'BUTTON'
}): Promise<Result<AutomationSendOutcome>> {
  const connection = await WhatsAppConnectionRepository.findById(
    input.connectionId,
    input.workspaceId,
  )
  if (!connection.ok) return connection
  if (!connection.value) return err(whatsappConnectionNotFound())
  if (connection.value.status !== 'CONNECTED') {
    return ok({
      kind: 'not_ready',
      reason: 'A conexão do WhatsApp está offline',
    })
  }
  if (connection.value.provider !== 'META') {
    return ok({
      kind: 'not_ready',
      reason: 'O envio automático por template exige a API oficial da Meta',
    })
  }

  const template = await WhatsAppTemplateRepository.findById(
    input.templateId,
    input.workspaceId,
  )
  if (!template.ok) return template
  if (!template.value) return err(whatsappTemplateNotFound())
  if (
    template.value.connectionId !== connection.value.id ||
    template.value.status !== 'APPROVED'
  ) {
    return ok({
      kind: 'not_ready',
      reason: 'O template não está aprovado nesta conexão',
    })
  }

  const contact = await WhatsAppContactRepository.upsertByWaId({
    workspaceId: input.workspaceId,
    waId: input.waId,
    name: input.contactName ?? undefined,
  })
  if (!contact.ok) return contact
  if (!input.ignoreOptOut && contact.value.broadcastOptedOutAt) {
    return ok({ kind: 'opted_out' })
  }

  const conversationId = await ensureConversation(
    input.workspaceId,
    connection.value,
    contact.value,
  )
  if (!conversationId.ok) return conversationId

  const components = bodyComponents(input.variables)
  const sent = await WhatsAppSend.template(
    connection.value,
    {
      to: input.waId,
      templateName: template.value.name,
      language: template.value.language,
      components: applyTemplateSendExtras(template.value, components)
        .components,
    },
    {
      cost: {
        source: input.costSource ?? 'OTHER',
        templateCategory: template.value.category,
        conversationId: conversationId.value,
      },
    },
  )
  if (!sent.ok) return sent

  const recorded = await recordOutboundMessage({
    workspaceId: input.workspaceId,
    conversationId: conversationId.value,
    type: 'TEMPLATE',
    text: templatePreview(template.value, input.variables),
    providerMessageId: sent.value.providerMessageId,
  })
  if (!recorded.ok) {
    // The customer already got it: never turn that into a failed send.
    logger.warn('whatsapp.automation.record_failed', {
      workspaceId: input.workspaceId,
      reason: recorded.error.code,
    })
  }
  return ok({
    kind: 'sent',
    conversationId: conversationId.value,
    providerMessageId: sent.value.providerMessageId,
  })
}

function bodyComponents(variables: string[]): unknown[] {
  if (variables.length === 0) return []
  return [
    {
      type: 'body',
      parameters: variables.map((value) => ({
        type: 'text',
        text: oneLine(value) || '-',
      })),
    },
  ]
}

/** Meta refuses newlines, tabs and long runs of spaces in a parameter. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 1000)
}

/** Template body with `{{n}}` filled in, for the timeline. */
export function templatePreview(
  template: Pick<WhatsAppTemplate, 'components' | 'name'>,
  variables: string[],
): string {
  const components = Array.isArray(template.components)
    ? (template.components as { type?: string; text?: string }[])
    : []
  const body = components.find((c) => c?.type === 'BODY')?.text
  if (!body) return template.name
  return body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => {
    const value = variables[Number(n) - 1]
    return value ? oneLine(value) : '-'
  })
}

/** The contact's open conversation, or a new one in the queue. */
export async function ensureConversation(
  workspaceId: string,
  connection: WhatsAppConnection,
  contact: WhatsAppContact,
): Promise<Result<string>> {
  const open = await WhatsAppConversationRepository.findActiveByContact(
    workspaceId,
    contact.id,
  )
  if (!open.ok) return open
  if (open.value) return ok(open.value.id)

  const allowed = await WhatsAppUsageService.assertCanSend(
    workspaceId,
    'conversations',
  )
  if (!allowed.ok) return allowed
  const created = await WhatsAppConversationRepository.create({
    workspaceId,
    connectionId: connection.id,
    contactId: contact.id,
    status: 'NEW',
  })
  if (!created.ok) return created
  await WhatsAppUsageService.record(workspaceId, 'conversations')
  return ok(created.value.id)
}
