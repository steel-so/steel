import type { WhatsAppMessage } from '@prisma/client'
import { wrapUntrusted } from '@/src/lib/ai/guardrails/injection'

/** Tones the agent can rewrite a draft in (Z7). */
export const WHATSAPP_COPILOT_TONES = [
  'FRIENDLY',
  'FORMAL',
  'DIRECT',
  'EMPATHETIC',
  'FIX_ONLY',
] as const

export type WhatsAppCopilotTone = (typeof WHATSAPP_COPILOT_TONES)[number]

export const WHATSAPP_COPILOT_TONE_LABEL: Record<WhatsAppCopilotTone, string> =
  {
    FRIENDLY: 'Mais cordial',
    FORMAL: 'Mais formal',
    DIRECT: 'Mais direto',
    EMPATHETIC: 'Mais empático',
    FIX_ONLY: 'Só corrigir o texto',
  }

const TONE_INSTRUCTION: Record<WhatsAppCopilotTone, string> = {
  FRIENDLY: 'cordial, acolhedor e simpático, sem exageros',
  FORMAL: 'formal e profissional, tratando o cliente por senhor(a)',
  DIRECT: 'direto e objetivo, sem rodeios, mantendo a educação',
  EMPATHETIC: 'empático, reconhecendo o que o cliente sente antes de resolver',
  FIX_ONLY:
    'o mesmo tom do original: corrija só ortografia, pontuação e concordância',
}

/** How many of the latest messages the copilot reads. */
export const WHATSAPP_COPILOT_HISTORY_LIMIT = 40
/** Per-message cap so one huge paste cannot eat the context. */
const MESSAGE_CHAR_CAP = 1_500

const MEDIA_LABEL: Record<string, string> = {
  IMAGE: '[imagem]',
  VIDEO: '[vídeo]',
  AUDIO: '[áudio]',
  DOCUMENT: '[documento]',
  STICKER: '[figurinha]',
  CONTACT: '[contato compartilhado]',
  LOCATION: '[localização]',
  TEMPLATE: '[template]',
}

/** One line of the transcript, or null when the message adds nothing. */
export function transcriptLine(
  message: Pick<
    WhatsAppMessage,
    'direction' | 'type' | 'text' | 'sentByAi' | 'deletedAt'
  >,
): string | null {
  if (message.deletedAt) return null
  const who =
    message.direction === 'IN'
      ? 'Cliente'
      : message.sentByAi
        ? 'Assistente (IA)'
        : 'Atendente'
  const text = message.text?.trim()
  const body = text
    ? text.slice(0, MESSAGE_CHAR_CAP)
    : (MEDIA_LABEL[message.type] ?? null)
  if (!body) return null
  return `${who}: ${body}`
}

/**
 * Chronological transcript fenced as untrusted data (ADR 0041): the customer
 * writes part of it, so it must never be read as instructions.
 */
export function buildTranscript(
  newestFirst: Parameters<typeof transcriptLine>[0][],
): string | null {
  const lines = newestFirst
    .slice()
    .reverse()
    .map(transcriptLine)
    .filter((line): line is string => line !== null)
  if (lines.length === 0) return null
  return wrapUntrusted(lines.join('\n'), 'whatsapp_message')
}

const COMMON_RULES =
  'Escreva sempre em português do Brasil. Não invente preços, prazos, políticas ou dados que não estejam na conversa. Não use markdown, só texto de WhatsApp.'

export function suggestSystemPrompt(input: {
  contactName?: string | null
  agentName?: string | null
  hint?: string
}): string {
  const parts = [
    'Você é um copiloto que ajuda um atendente humano a responder um cliente pelo WhatsApp. Leia a conversa e escreva UMA resposta pronta para o atendente enviar, curta e útil, na voz do atendente. Responda só com o texto da mensagem.',
    COMMON_RULES,
  ]
  if (input.contactName) parts.push(`Nome do cliente: ${input.contactName}.`)
  if (input.agentName) parts.push(`Nome do atendente: ${input.agentName}.`)
  if (input.hint) {
    parts.push(
      `Orientação do atendente para esta resposta (siga): ${input.hint}`,
    )
  }
  return parts.join('\n')
}

export function summarySystemPrompt(): string {
  return [
    'Você resume conversas de atendimento por WhatsApp para o atendente que está assumindo (por exemplo, numa transferência). Responda só com um JSON {"summary": string, "pending": string[]}.',
    '"summary": 2 a 4 frases com o assunto, o que já foi feito e o estado atual. "pending": o que ainda falta resolver ou foi prometido ao cliente (lista vazia se nada).',
    COMMON_RULES,
  ].join('\n')
}

export const SUMMARY_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    pending: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'pending'],
  additionalProperties: false,
}

export function toneSystemPrompt(tone: WhatsAppCopilotTone): string {
  return [
    `Você reescreve a mensagem de um atendente antes de enviar ao cliente pelo WhatsApp. Tom desejado: ${TONE_INSTRUCTION[tone]}. Preserve o significado, os fatos, números, links e o idioma. Responda só com a mensagem reescrita.`,
    COMMON_RULES,
  ].join('\n')
}

export interface WhatsAppCopilotSummaryResult {
  summary: string
  pending: string[]
}

export function parseSummaryResponse(
  content: string,
): WhatsAppCopilotSummaryResult | null {
  try {
    const parsed = JSON.parse(content)
    if (typeof parsed?.summary !== 'string' || !parsed.summary.trim()) {
      return null
    }
    const pending = Array.isArray(parsed.pending)
      ? parsed.pending.filter(
          (item: unknown): item is string =>
            typeof item === 'string' && item.trim().length > 0,
        )
      : []
    return {
      summary: parsed.summary.trim(),
      pending: pending.map((item: string) => item.trim()).slice(0, 10),
    }
  } catch {
    return null
  }
}

/** Models sometimes wrap the text in quotes or fences; strip them. */
export function cleanCompletion(text: string): string {
  return text
    .trim()
    .replace(/^```[a-z]*\n?|\n?```$/gi, '')
    .trim()
    .replace(/^["“](.*)["”]$/s, '$1')
    .trim()
}
