import type {
  WhatsAppAiCampaignActionRunStatus,
  WhatsAppBroadcastRecipientStatus,
  WhatsAppBroadcastStatus,
  WhatsAppCostCategory,
  WhatsAppCostKind,
  WhatsAppCostSource,
  WhatsAppMessageDirection,
  WhatsAppMessageStatus,
  WhatsAppMessageType,
  WhatsAppProvider,
  WhatsAppSentiment,
  WhatsAppTemplateHeaderFormat,
  WhatsAppTemplateQuality,
  WhatsAppTemplateStatus,
} from '@prisma/client'
import { AI_CAMPAIGN_ACTION_KIND_LABEL } from '@/src/lib/whatsapp/ai-campaign-actions'
import {
  deriveTemplateButtons,
  parseStoredButtons,
} from '@/src/lib/whatsapp/buttons'
import type {
  WaBroadcastRecipientData,
  WaCostData,
  WaDashboardActionRun,
  WaDashboardBroadcastRecipient,
  WaDashboardCost,
  WaDashboardMessage,
  WaDashboardTemplate,
} from '@/src/repositories/whatsapp-dashboard-messaging.repository'
import type {
  WaAiCampaignActionDashboardRow,
  WaBroadcastRecipientDashboardRow,
  WaCostDashboardRow,
  WaMessageDashboardRow,
  WaTemplateDashboardRow,
} from '@/types/whatsapp-dashboard-messaging'

/* --------------------------------- labels ---------------------------------- */

export const WA_PROVIDER_LABELS: Record<WhatsAppProvider, string> = {
  META: 'Meta (API oficial)',
  ZAPI: 'Z-API',
  WIDGET: 'Widget do site',
}

export const WA_MESSAGE_DIRECTION_LABELS: Record<
  WhatsAppMessageDirection,
  string
> = {
  IN: 'Recebida',
  OUT: 'Enviada',
}

export const WA_MESSAGE_TYPE_LABELS: Record<WhatsAppMessageType, string> = {
  TEXT: 'Texto',
  IMAGE: 'Imagem',
  AUDIO: 'Áudio',
  VIDEO: 'Vídeo',
  DOCUMENT: 'Documento',
  STICKER: 'Figurinha',
  LOCATION: 'Localização',
  TEMPLATE: 'Modelo',
  BUTTON: 'Botão',
  CONTACT: 'Contato',
}

export const WA_MESSAGE_STATUS_LABELS: Record<WhatsAppMessageStatus, string> = {
  PENDING: 'Pendente',
  SENT: 'Enviada',
  DELIVERED: 'Entregue',
  READ: 'Lida',
  FAILED: 'Falhou',
}

/** Status of a message of the contact: it has no delivery cycle. */
export const WA_MESSAGE_STATUS_RECEIVED = 'Recebida'

export const WA_MESSAGE_AUTHOR = {
  contact: 'Contato',
  ai: 'IA',
  attendant: 'Atendente',
  system: 'Sistema',
} as const

export const WA_SENTIMENT_LABELS: Record<WhatsAppSentiment, string> = {
  POSITIVE: 'Positivo',
  NEUTRAL: 'Neutro',
  NEGATIVE: 'Negativo',
}

export const WA_BROADCAST_STATUS_LABELS: Record<
  WhatsAppBroadcastStatus,
  string
> = {
  DRAFT: 'Rascunho',
  QUEUED: 'Agendada',
  RUNNING: 'Enviando',
  PAUSED: 'Pausada',
  DONE: 'Concluída',
  FAILED: 'Falhou',
}

export const WA_BROADCAST_RECIPIENT_STATUS_LABELS: Record<
  WhatsAppBroadcastRecipientStatus,
  string
> = {
  PENDING: 'Pendente',
  SENT: 'Enviado',
  FAILED: 'Falhou',
  SKIPPED: 'Ignorado',
  SKIPPED_NO_WHATSAPP: 'Sem WhatsApp',
}

const DELIVERY_LABELS: Record<string, string> = {
  READ: 'Lida',
  DELIVERED: 'Entregue',
  FAILED: 'Não entregue',
}

/** Meta's category is free text in the model: unknown values pass through. */
const TEMPLATE_CATEGORY_LABELS: Record<string, string> = {
  MARKETING: 'Marketing',
  UTILITY: 'Utilidade',
  AUTHENTICATION: 'Autenticação',
}

export const WA_TEMPLATE_STATUS_LABELS: Record<WhatsAppTemplateStatus, string> =
  {
    APPROVED: 'Aprovado',
    PENDING: 'Em análise',
    REJECTED: 'Rejeitado',
    PAUSED: 'Pausado',
    DISABLED: 'Desativado',
  }

export const WA_TEMPLATE_QUALITY_LABELS: Record<
  WhatsAppTemplateQuality,
  string
> = {
  GREEN: 'Alta',
  YELLOW: 'Média',
  RED: 'Baixa',
  UNKNOWN: 'Sem avaliação',
}

export const WA_TEMPLATE_HEADER_LABELS: Record<
  WhatsAppTemplateHeaderFormat,
  string
> = {
  TEXT: 'Texto',
  IMAGE: 'Imagem',
  VIDEO: 'Vídeo',
  DOCUMENT: 'Documento',
}

/** Same wording as the Custos page (`WhatsAppCostService`). */
export const WA_COST_CATEGORY_LABELS: Record<WhatsAppCostCategory, string> = {
  MARKETING: 'Marketing',
  UTILITY: 'Utilidade',
  AUTHENTICATION: 'Autenticação',
  SERVICE: 'Atendimento (janela de 24 h)',
}

export const WA_COST_KIND_LABELS: Record<WhatsAppCostKind, string> = {
  TEMPLATE: 'Modelo',
  SERVICE: 'Atendimento',
}

export const WA_COST_ORIGIN_LABELS: Record<WhatsAppCostSource, string> = {
  BROADCAST: 'Transmissões',
  AI_CAMPAIGN: 'Campanhas de IA',
  CRM_CAMPAIGN: 'Campanhas do CRM',
  AGENT: 'Atendentes',
  AI_REPLY: 'Respostas da IA',
  BUTTON: 'Botões',
  OTHER: 'Outros',
}

export const WA_ACTION_RUN_STATUS_LABELS: Record<
  WhatsAppAiCampaignActionRunStatus,
  string
> = {
  SUCCESS: 'Sucesso',
  FAILED: 'Falhou',
}

/** 0/100 so that the average of the field is a rate. */
function pct(hit: boolean): number {
  return hit ? 100 : 0
}

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null
}

/* -------------------------------- messages --------------------------------- */

function authorOf(message: WaDashboardMessage): string {
  if (message.direction === 'IN') return WA_MESSAGE_AUTHOR.contact
  if (message.sentByAi) return WA_MESSAGE_AUTHOR.ai
  if (message.senderUserId !== null) return WA_MESSAGE_AUTHOR.attendant
  return WA_MESSAGE_AUTHOR.system
}

export function toWaMessageRow(
  message: WaDashboardMessage,
): WaMessageDashboardRow {
  const outbound = message.direction === 'OUT'
  const author = authorOf(message)
  const failed = outbound && message.status === 'FAILED'
  return {
    id: message.id,
    direction: WA_MESSAGE_DIRECTION_LABELS[message.direction],
    type: WA_MESSAGE_TYPE_LABELS[message.type],
    status: outbound
      ? WA_MESSAGE_STATUS_LABELS[message.status]
      : WA_MESSAGE_STATUS_RECEIVED,
    author,
    attendant:
      author === WA_MESSAGE_AUTHOR.attendant
        ? (message.senderUser?.name ?? null)
        : null,
    isFailed: failed,
    failureReason: failed ? message.failureReason : null,
    deliveredPct: outbound
      ? pct(message.status === 'DELIVERED' || message.status === 'READ')
      : null,
    readPct: outbound ? pct(message.status === 'READ') : null,
    failedPct: outbound ? pct(failed) : null,
    sentiment: message.sentiment
      ? WA_SENTIMENT_LABELS[message.sentiment]
      : null,
    sentimentScore: message.sentimentScore,
    connection: message.conversation.connection.label,
    provider: WA_PROVIDER_LABELS[message.conversation.connection.provider],
    team: message.conversation.team?.name ?? null,
    aiCampaign: message.conversation.aiCampaign?.name ?? null,
    createdAt: message.createdAt.toISOString(),
  }
}

/** One row per message, in the order the repository answered. */
export function toWaMessageRows(
  messages: WaDashboardMessage[],
): WaMessageDashboardRow[] {
  return messages.map(toWaMessageRow)
}

/* --------------------------- broadcast recipients --------------------------- */

function toBroadcastRecipientRow(
  recipient: WaDashboardBroadcastRecipient,
  deliveryStatus: Map<string, string>,
): WaBroadcastRecipientDashboardRow {
  const sent = recipient.status === 'SENT'
  const providerStatus = recipient.providerMessageId
    ? deliveryStatus.get(recipient.providerMessageId)
    : undefined
  const delivery = sent
    ? (providerStatus && DELIVERY_LABELS[providerStatus]) || 'Enviada'
    : null
  return {
    id: recipient.id,
    broadcast: recipient.broadcastList.name,
    broadcastStatus: WA_BROADCAST_STATUS_LABELS[recipient.broadcastList.status],
    status: WA_BROADCAST_RECIPIENT_STATUS_LABELS[recipient.status],
    isSent: sent,
    isFailed: recipient.status === 'FAILED',
    error: recipient.errorMessage,
    template: recipient.broadcastList.template?.name ?? null,
    connection: recipient.broadcastList.connection.label,
    viaMarketingLite: recipient.viaMarketingLite,
    delivery,
    isDelivered: delivery === 'Lida' || delivery === 'Entregue',
    scheduledAt: iso(recipient.scheduledAt),
    sentAt: iso(recipient.sentAt),
    createdAt: recipient.createdAt.toISOString(),
  }
}

/** One row per recipient, in the order the repository answered. */
export function toWaBroadcastRecipientRows(
  data: WaBroadcastRecipientData,
): WaBroadcastRecipientDashboardRow[] {
  const deliveryStatus = new Map(
    data.deliveries.map((d) => [d.providerMessageId, d.status]),
  )
  return data.recipients.map((recipient) =>
    toBroadcastRecipientRow(recipient, deliveryStatus),
  )
}

/* -------------------------------- templates -------------------------------- */

export function toWaTemplateRow(
  template: WaDashboardTemplate,
): WaTemplateDashboardRow {
  // Stored buttons (with our actions) win; a template synced from Meta
  // without them has its buttons derived from the components.
  const stored = parseStoredButtons(template.buttons)
  const buttonCount =
    stored.length > 0
      ? stored.length
      : deriveTemplateButtons(template.components).length
  return {
    id: template.id,
    name: template.name,
    language: template.language,
    category: TEMPLATE_CATEGORY_LABELS[template.category] ?? template.category,
    status: WA_TEMPLATE_STATUS_LABELS[template.status],
    quality: WA_TEMPLATE_QUALITY_LABELS[template.quality],
    connection: template.connection.label,
    header: template.headerFormat
      ? WA_TEMPLATE_HEADER_LABELS[template.headerFormat]
      : null,
    hasButtons: buttonCount > 0,
    buttonCount,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  }
}

export function toWaTemplateRows(
  templates: WaDashboardTemplate[],
): WaTemplateDashboardRow[] {
  return templates.map(toWaTemplateRow)
}

/* ---------------------------------- costs ---------------------------------- */

function toCostRow(
  entry: WaDashboardCost,
  broadcastNames: Map<string, string>,
  aiCampaignNames: Map<string, string>,
): WaCostDashboardRow {
  return {
    id: entry.id,
    category: WA_COST_CATEGORY_LABELS[entry.category],
    kind: WA_COST_KIND_LABELS[entry.kind],
    origin: WA_COST_ORIGIN_LABELS[entry.source],
    amount: Number(entry.estimatedCost),
    unitPrice: Number(entry.unitPrice),
    quantity: entry.quantity,
    currency: entry.currency,
    connection: entry.connection.label,
    provider: WA_PROVIDER_LABELS[entry.provider],
    viaMarketingLite: entry.viaMarketingLite,
    isReversed: entry.reversedAt !== null,
    broadcast: entry.broadcastId
      ? (broadcastNames.get(entry.broadcastId) ?? null)
      : null,
    aiCampaign: entry.aiCampaignId
      ? (aiCampaignNames.get(entry.aiCampaignId) ?? null)
      : null,
    occurredAt: entry.occurredAt.toISOString(),
  }
}

/** One row per ledger entry, in the order the repository answered. */
export function toWaCostRows(data: WaCostData): WaCostDashboardRow[] {
  const broadcastNames = new Map(data.broadcasts.map((b) => [b.id, b.name]))
  const aiCampaignNames = new Map(data.aiCampaigns.map((c) => [c.id, c.name]))
  return data.entries.map((entry) =>
    toCostRow(entry, broadcastNames, aiCampaignNames),
  )
}

/* ---------------------------- AI campaign actions --------------------------- */

const ACTION_KIND_LABELS: Record<string, string> = AI_CAMPAIGN_ACTION_KIND_LABEL

export function toWaAiCampaignActionRow(
  run: WaDashboardActionRun,
): WaAiCampaignActionDashboardRow {
  return {
    id: run.id,
    campaign: run.campaign.name,
    // `kind` is a copy in free text: a kind removed later keeps its code.
    actionType: ACTION_KIND_LABELS[run.kind] ?? run.kind,
    action: run.label,
    status: WA_ACTION_RUN_STATUS_LABELS[run.status],
    isSuccess: run.status === 'SUCCESS',
    error: run.error,
    createdAt: run.createdAt.toISOString(),
  }
}

export function toWaAiCampaignActionRows(
  runs: WaDashboardActionRun[],
): WaAiCampaignActionDashboardRow[] {
  return runs.map(toWaAiCampaignActionRow)
}
