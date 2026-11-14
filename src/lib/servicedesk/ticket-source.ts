import type { SdTicketSourceKind } from '@/src/schemas/sd-ticket-source.schema'

/**
 * Pure rules (no I/O) of "open a ticket from a conversation or CRM record":
 * title, description and the "is this ticket still open" test.
 */

const TITLE_MAX = 200
const SNIPPET_MAX = 90
const MESSAGE_MAX = 600

export interface SourceMessageInput {
  direction: 'IN' | 'OUT'
  type: string
  text: string | null
  sentByAi: boolean
  createdAt: Date
}

export interface SourceMessageLine {
  at: Date
  /** Who wrote it, in pt-BR. */
  author: 'Cliente' | 'Atendente' | 'IA'
  text: string
}

export interface SourceDetail {
  label: string
  value: string
}

const MEDIA_LABEL: Record<string, string> = {
  IMAGE: '[imagem]',
  VIDEO: '[vídeo]',
  AUDIO: '[áudio]',
  DOCUMENT: '[documento]',
  STICKER: '[figurinha]',
  LOCATION: '[localização]',
  CONTACT: '[contato]',
  CONTACTS: '[contato]',
  TEMPLATE: '[modelo de mensagem]',
  BUTTON: '[botão]',
}

function clip(value: string, max: number): string {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** A message as one line for the description; `null` when there is nothing to quote. */
export function toSourceMessageLine(
  message: SourceMessageInput,
): SourceMessageLine | null {
  const body = message.text?.trim()
  const text = body
    ? clip(body, MESSAGE_MAX)
    : (MEDIA_LABEL[message.type] ?? null)
  if (!text) return null
  return {
    at: message.createdAt,
    author:
      message.direction === 'IN'
        ? 'Cliente'
        : message.sentByAi
          ? 'IA'
          : 'Atendente',
    text,
  }
}

/** Date and time in `timeZone` (never the server's): "13/11/2026 14:05". */
export function formatSourceTime(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`
}

export interface SourceTitleInput {
  source: SdTicketSourceKind
  /** Contact, lead, person or deal name. */
  label: string
  /** Last thing the customer wrote (conversation only). */
  lastCustomerText?: string | null
}

export function buildSourceTitle(input: SourceTitleInput): string {
  const label = clip(input.label, 80) || 'sem nome'
  let title: string
  switch (input.source) {
    case 'conversation': {
      const snippet = input.lastCustomerText
        ? clip(input.lastCustomerText, SNIPPET_MAX)
        : ''
      title = snippet
        ? `${label}: ${snippet}`
        : `Atendimento no WhatsApp: ${label}`
      break
    }
    case 'lead':
      title = `Chamado do lead ${label}`
      break
    case 'person':
      title = `Chamado de ${label}`
      break
    case 'opportunity':
      title = `Chamado da oportunidade ${label}`
      break
  }
  return clip(title, TITLE_MAX)
}

export interface SourceDescriptionInput {
  source: SdTicketSourceKind
  sourceLabel: string
  details: SourceDetail[]
  note?: string | null
  messages: SourceMessageLine[]
  timeZone: string
}

const ORIGIN_LABEL: Record<SdTicketSourceKind, string> = {
  conversation: 'Conversa do WhatsApp',
  lead: 'Lead do CRM',
  person: 'Pessoa do CRM',
  opportunity: 'Oportunidade do CRM',
}

function noteParagraphs(note: string): string[] {
  return note
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
}

/** Description as the rich editor's HTML (everything user-provided is escaped). */
export function buildSourceDescriptionHtml(
  input: SourceDescriptionInput,
): string {
  const html: string[] = []
  const note = input.note?.trim()
  if (note) {
    for (const paragraph of noteParagraphs(note)) {
      html.push(`<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    }
  }
  html.push(
    `<p><strong>Origem:</strong> ${ORIGIN_LABEL[input.source]} — ${escapeHtml(input.sourceLabel)}</p>`,
  )
  if (input.details.length > 0) {
    html.push(
      `<ul>${input.details
        .map(
          (d) =>
            `<li><strong>${escapeHtml(d.label)}:</strong> ${escapeHtml(d.value)}</li>`,
        )
        .join('')}</ul>`,
    )
  }
  if (input.messages.length > 0) {
    html.push(
      `<p><strong>Últimas mensagens (${input.messages.length}):</strong></p>`,
    )
    html.push(
      `<blockquote>${input.messages
        .map(
          (m) =>
            `<p><em>${escapeHtml(formatSourceTime(m.at, input.timeZone))}</em> <strong>${m.author}:</strong> ${escapeHtml(m.text)}</p>`,
        )
        .join('')}</blockquote>`,
    )
  }
  return html.join('')
}

/** Same content as plain text, for the preview in the dialog. */
export function buildSourceDescriptionText(
  input: SourceDescriptionInput,
): string {
  const lines: string[] = []
  const note = input.note?.trim()
  if (note) lines.push(note, '')
  lines.push(`Origem: ${ORIGIN_LABEL[input.source]} — ${input.sourceLabel}`)
  for (const d of input.details) lines.push(`${d.label}: ${d.value}`)
  if (input.messages.length > 0) {
    lines.push('', `Últimas mensagens (${input.messages.length}):`)
    for (const m of input.messages) {
      lines.push(
        `${formatSourceTime(m.at, input.timeZone)} ${m.author}: ${m.text}`,
      )
    }
  }
  return lines.join('\n')
}

/** A ticket is still open until it is resolved, closed or canceled. */
export function isSourceTicketOpen(phaseCategory: string): boolean {
  return !['RESOLVED', 'CLOSED', 'CANCELED'].includes(phaseCategory)
}
