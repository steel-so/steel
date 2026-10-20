import type {
  WhatsAppMessageDirection,
  WhatsAppMessageType,
} from '@prisma/client'
import { toCsv } from '@/src/lib/crm-export'

/** Formats a conversation can be downloaded in. */
export const WHATSAPP_CONVERSATION_EXPORT_FORMATS = ['txt', 'csv'] as const
export type WhatsAppConversationExportFormat =
  (typeof WHATSAPP_CONVERSATION_EXPORT_FORMATS)[number]

/** Hard cap of messages in one download — keeps the response bounded. */
export const WHATSAPP_CONVERSATION_EXPORT_MAX_MESSAGES = 20_000

const EXPORT_TIME_ZONE = 'America/Sao_Paulo'

export interface ExportableWhatsAppMessage {
  direction: WhatsAppMessageDirection
  type: WhatsAppMessageType
  text: string | null
  mediaUrl: string | null
  sentByAi: boolean
  senderName: string | null
  createdAt: Date
}

export interface WhatsAppConversationExportInput {
  contactName: string | null
  contactWaId: string
  messages: ExportableWhatsAppMessage[]
}

export interface WhatsAppConversationExportFile {
  fileName: string
  contentType: string
  body: string
}

const TYPE_PLACEHOLDER: Record<WhatsAppMessageType, string> = {
  TEXT: '',
  IMAGE: '[imagem]',
  AUDIO: '[áudio]',
  VIDEO: '[vídeo]',
  DOCUMENT: '[documento]',
  STICKER: '[figurinha]',
  LOCATION: '[localização]',
  TEMPLATE: '[template]',
  BUTTON: '[botão]',
  CONTACT: '[contato]',
}

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: EXPORT_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function formatDateTime(date: Date): string {
  return dateTimeFormatter.format(date).replace(',', '')
}

function senderLabel(
  message: ExportableWhatsAppMessage,
  contactLabel: string,
): string {
  if (message.direction === 'IN') return contactLabel
  if (message.sentByAi) return 'IA'
  return message.senderName ?? 'Atendente'
}

/** Message body as plain text: text/caption, a media placeholder and its URL. */
function messageContent(message: ExportableWhatsAppMessage): string {
  const placeholder = TYPE_PLACEHOLDER[message.type]
  const text = message.text?.trim() ?? ''
  const parts = [
    message.type === 'TEXT' ? '' : placeholder,
    text,
    message.mediaUrl ?? '',
  ].filter(Boolean)
  return parts.join(' ')
}

function fileSlug(input: WhatsAppConversationExportInput): string {
  const base = (input.contactName ?? input.contactWaId)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return base || input.contactWaId
}

/**
 * Builds the downloadable transcript of a conversation: a WhatsApp-like
 * `.txt` (`[dd/mm/aaaa hh:mm] Nome: mensagem`) or a `.csv` with one row per
 * message. Times are in America/Sao_Paulo.
 */
export function buildWhatsAppConversationExport(
  input: WhatsAppConversationExportInput,
  format: WhatsAppConversationExportFormat,
): WhatsAppConversationExportFile {
  const contactLabel = input.contactName ?? input.contactWaId
  const fileName = `conversa-${fileSlug(input)}.${format}`

  if (format === 'csv') {
    const columns = ['Data/hora', 'Direção', 'Remetente', 'Tipo', 'Mensagem']
    const rows = input.messages.map((message) => ({
      'Data/hora': formatDateTime(message.createdAt),
      Direção: message.direction === 'IN' ? 'Recebida' : 'Enviada',
      Remetente: senderLabel(message, contactLabel),
      Tipo: message.type,
      Mensagem: messageContent(message),
    }))
    return {
      fileName,
      contentType: 'text/csv; charset=utf-8',
      body: toCsv(columns, rows),
    }
  }

  const header = [
    `Conversa com ${contactLabel} (+${input.contactWaId})`,
    `Exportada em ${formatDateTime(new Date())}`,
    '',
  ]
  const lines = input.messages.map(
    (message) =>
      `[${formatDateTime(message.createdAt)}] ${senderLabel(message, contactLabel)}: ${messageContent(message)}`,
  )
  return {
    fileName,
    contentType: 'text/plain; charset=utf-8',
    body: [...header, ...lines].join('\n'),
  }
}
