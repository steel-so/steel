import type {
  WhatsAppAiCampaignRecipientStatus,
  WhatsAppAiCampaignStatus,
  WhatsAppCloseOutcome,
} from '@prisma/client'
import { blockWaIdVariants } from '@/src/lib/whatsapp/contact-block'
import type {
  WaAiCampaignRecipientData,
  WaDashboardButtonReply,
  WaDashboardConversation,
  WaDashboardRecipient,
} from '@/src/repositories/whatsapp-dashboard-source.repository'
import type { WaAiCampaignRecipientDashboardRow } from '@/types/whatsapp-dashboard'

/* --------------------------------- labels ---------------------------------- */

export const WA_AI_CAMPAIGN_STATUS_LABELS: Record<
  WhatsAppAiCampaignStatus,
  string
> = {
  DRAFT: 'Rascunho',
  RUNNING: 'Enviando',
  PAUSED: 'Pausada',
  DONE: 'Concluída',
  ARCHIVED: 'Arquivada',
}

export const WA_AI_CAMPAIGN_SEND_LABELS: Record<
  WhatsAppAiCampaignRecipientStatus,
  string
> = {
  PENDING: 'Pendente',
  SENT: 'Enviado',
  FAILED: 'Falhou',
  SKIPPED: 'Ignorado',
}

const DELIVERY_LABELS: Record<string, string> = {
  READ: 'Lida',
  DELIVERED: 'Entregue',
  FAILED: 'Não entregue',
}

export const WA_CLOSE_OUTCOME_LABELS: Record<WhatsAppCloseOutcome, string> = {
  SUCCESS: 'Deu certo',
  FAILURE: 'Não deu',
}

export const WA_RESPONSE_NONE = 'Sem retorno'
export const WA_RESPONSE_OTHER = 'Outra resposta'

/**
 * Label of a clicked button: `SIM`/`sim` and `NAO`/`Não`/`NÃO` become one
 * category each; any other button keeps its own text.
 */
export function waButtonAnswerLabel(text: string | null): string {
  const trimmed = (text ?? '').trim()
  const folded = trimmed.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  if (folded === 'sim') return 'Sim'
  if (folded === 'nao') return 'Não'
  return trimmed || WA_RESPONSE_OTHER
}

/* ----------------------------- AI campaign rows ----------------------------- */

interface RecipientIndexes {
  conversationsById: Map<string, WaDashboardConversation>
  /** Conversations by the contact's `waId`, most recent answer first. */
  conversationsByWaId: Map<string, WaDashboardConversation[]>
  /** Button clicks by conversation, oldest first. */
  buttonsByConversation: Map<string, WaDashboardButtonReply[]>
  humanReplyAt: Map<string, Date>
  deliveryStatus: Map<string, string>
}

function indexesOf(data: WaAiCampaignRecipientData): RecipientIndexes {
  const conversationsById = new Map<string, WaDashboardConversation>()
  const conversationsByWaId = new Map<string, WaDashboardConversation[]>()
  for (const conversation of data.conversations) {
    conversationsById.set(conversation.id, conversation)
    const list = conversationsByWaId.get(conversation.contact.waId)
    if (list) list.push(conversation)
    else conversationsByWaId.set(conversation.contact.waId, [conversation])
  }
  const buttonsByConversation = new Map<string, WaDashboardButtonReply[]>()
  for (const reply of data.buttonReplies) {
    const list = buttonsByConversation.get(reply.conversationId)
    if (list) list.push(reply)
    else buttonsByConversation.set(reply.conversationId, [reply])
  }
  return {
    conversationsById,
    conversationsByWaId,
    buttonsByConversation,
    humanReplyAt: new Map(
      data.humanReplies.map((reply) => [reply.conversationId, reply.lastAt]),
    ),
    deliveryStatus: new Map(
      data.deliveries.map((d) => [d.providerMessageId, d.status]),
    ),
  }
}

/**
 * Conversations where this recipient answered after the send, most recent
 * answer first. Meta may deliver the answer of a Brazilian mobile from the
 * number without the ninth digit, which lands in another contact and
 * conversation: both spellings of the number count as the same person.
 */
function answeredConversations(
  recipient: WaDashboardRecipient,
  sentAt: Date,
  indexes: RecipientIndexes,
): WaDashboardConversation[] {
  const found = new Map<string, WaDashboardConversation>()
  const own = recipient.conversationId
    ? indexes.conversationsById.get(recipient.conversationId)
    : undefined
  if (own) found.set(own.id, own)
  for (const waId of blockWaIdVariants(recipient.contact.waId)) {
    for (const conversation of indexes.conversationsByWaId.get(waId) ?? []) {
      found.set(conversation.id, conversation)
    }
  }
  return [...found.values()]
    .filter(
      (conversation) =>
        conversation.lastInboundAt !== null &&
        conversation.lastInboundAt.getTime() >= sentAt.getTime(),
    )
    .sort(
      (a, b) =>
        (b.lastInboundAt?.getTime() ?? 0) - (a.lastInboundAt?.getTime() ?? 0),
    )
}

function firstButtonAfter(
  conversations: WaDashboardConversation[],
  sentAt: Date,
  indexes: RecipientIndexes,
): WaDashboardButtonReply | null {
  let first: WaDashboardButtonReply | null = null
  for (const conversation of conversations) {
    for (const reply of indexes.buttonsByConversation.get(conversation.id) ??
      []) {
      if (reply.createdAt.getTime() < sentAt.getTime()) continue
      if (!first || reply.createdAt.getTime() < first.createdAt.getTime()) {
        first = reply
      }
    }
  }
  return first
}

function deliveryOf(
  recipient: WaDashboardRecipient,
  indexes: RecipientIndexes,
): string {
  const status = recipient.providerMessageId
    ? indexes.deliveryStatus.get(recipient.providerMessageId)
    : undefined
  return (status && DELIVERY_LABELS[status]) || 'Enviada'
}

function toRow(
  recipient: WaDashboardRecipient,
  indexes: RecipientIndexes,
): WaAiCampaignRecipientDashboardRow {
  const base = {
    id: recipient.id,
    campaign: recipient.campaign.name,
    campaignStatus: WA_AI_CAMPAIGN_STATUS_LABELS[recipient.campaign.status],
    sendStatus: WA_AI_CAMPAIGN_SEND_LABELS[recipient.status],
    sentAt: recipient.sentAt ? recipient.sentAt.toISOString() : null,
    createdAt: recipient.createdAt.toISOString(),
  }
  const sentAt = recipient.sentAt
  if (recipient.status !== 'SENT' || !sentAt) {
    return {
      ...base,
      isSent: false,
      delivery: null,
      isDelivered: false,
      response: null,
      replied: false,
      transferred: false,
      stage: null,
      isWaiting: false,
      attendant: null,
      team: null,
      outcome: null,
      closeStatus: [],
      repliedAt: null,
      closedAt: null,
    }
  }

  const delivery = deliveryOf(recipient, indexes)
  const answered = answeredConversations(recipient, sentAt, indexes)
  const primary = answered[0] ?? null
  const button = firstButtonAfter(answered, sentAt, indexes)
  const replied = answered.length > 0 || recipient.repliedAt !== null
  const humanAt = primary ? indexes.humanReplyAt.get(primary.id) : undefined
  const attended =
    humanAt !== undefined && humanAt.getTime() >= sentAt.getTime()
  const open = primary !== null && primary.status !== 'CLOSED'

  let stage = WA_RESPONSE_NONE
  if (replied) {
    if (!open) stage = 'Encerrada'
    else stage = attended ? 'Em atendimento' : 'Aguardando atendimento'
  }
  let response = WA_RESPONSE_NONE
  if (button) response = waButtonAnswerLabel(button.text)
  else if (replied) response = WA_RESPONSE_OTHER

  const repliedAt =
    recipient.repliedAt ?? button?.createdAt ?? primary?.lastInboundAt ?? null

  return {
    ...base,
    isSent: true,
    delivery,
    // An answer proves the delivery even when the provider status is late.
    isDelivered: replied || delivery === 'Lida' || delivery === 'Entregue',
    response,
    replied,
    transferred:
      primary !== null &&
      (primary.assignedUserId !== null || primary.aiHandoff),
    stage,
    isWaiting: replied && open && !attended,
    attendant: primary?.assignedUser?.name ?? null,
    team: primary?.team?.name ?? null,
    outcome: primary?.closeOutcome
      ? WA_CLOSE_OUTCOME_LABELS[primary.closeOutcome]
      : null,
    closeStatus: primary?.closeStatusLabels ?? [],
    repliedAt: repliedAt ? repliedAt.toISOString() : null,
    closedAt: primary?.closedAt ? primary.closedAt.toISOString() : null,
  }
}

/** One row per recipient, in the order the repository answered. */
export function toWaAiCampaignRecipientRows(
  data: WaAiCampaignRecipientData,
): WaAiCampaignRecipientDashboardRow[] {
  const indexes = indexesOf(data)
  return data.recipients.map((recipient) => toRow(recipient, indexes))
}
