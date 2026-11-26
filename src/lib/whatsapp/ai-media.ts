import type { AiToolCall, AiToolSpec } from '@/src/lib/ai'

/**
 * Library of images and videos the AI can send in a conversation. The user
 * uploads the file, names it and says when to send it; the AI gets the list
 * in its prompt and one tool (`enviar_midia`) to attach a file to its reply.
 */

export const AI_MEDIA_TOOL_NAME = 'enviar_midia'

export const AI_MEDIA_NAME_MAX = 60
export const AI_MEDIA_WHEN_MAX = 500
/** Limits of the Meta Cloud API (the strictest of both providers). */
const IMAGE_MAX_BYTES = 5 * 1024 * 1024
const VIDEO_MAX_BYTES = 16 * 1024 * 1024

export interface AiMediaItem {
  key: string
  name: string
  whenToSend: string
  mediaType: 'IMAGE' | 'VIDEO'
}

/** `Print do painel` → `print_do_painel` (stable id for the tool). */
export function aiMediaKeyFromName(name: string): string | null {
  const key = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/, '')
  return key || null
}

export type AiMediaClassification =
  | { ok: true; mediaType: 'IMAGE' | 'VIDEO' }
  | { ok: false; message: string }

/** What WhatsApp accepts: JPEG/PNG up to 5 MB, MP4/3GPP up to 16 MB. */
export function classifyAiMedia(
  contentType: string,
  byteSize: number,
): AiMediaClassification {
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  if (type === 'image/jpeg' || type === 'image/png') {
    return byteSize > IMAGE_MAX_BYTES
      ? { ok: false, message: 'Imagem muito grande. Máximo 5 MB.' }
      : { ok: true, mediaType: 'IMAGE' }
  }
  if (type === 'video/mp4' || type === 'video/3gpp') {
    return byteSize > VIDEO_MAX_BYTES
      ? { ok: false, message: 'Vídeo muito grande. Máximo 16 MB.' }
      : { ok: true, mediaType: 'VIDEO' }
  }
  return {
    ok: false,
    message: 'Formato não aceito. Use imagem JPG ou PNG, ou vídeo MP4.',
  }
}

/** The tool the AI calls to attach one file of the library to its reply. */
export function buildAiMediaTool(items: AiMediaItem[]): AiToolSpec {
  return {
    name: AI_MEDIA_TOOL_NAME,
    description:
      'Envia ao cliente uma imagem ou um vídeo da biblioteca de arquivos, junto da sua resposta. Use somente quando a regra do arquivo mandar enviar. Você pode escolher um arquivo por chamada.',
    parameters: {
      type: 'object',
      properties: {
        arquivo: {
          type: 'string',
          enum: items.map((item) => item.key),
          description: 'Identificador do arquivo a enviar.',
        },
      },
      required: ['arquivo'],
      additionalProperties: false,
    },
  }
}

/** Prompt section: the files and the rule of when to send each one. */
export function buildAiMediaSection(items: AiMediaItem[]): string {
  if (items.length === 0) return ''
  const lines = items.map(
    (item) =>
      `- ${item.key} (${item.mediaType === 'VIDEO' ? 'vídeo' : 'imagem'}, "${item.name}"): ${item.whenToSend}`,
  )
  return `\n\nArquivos que você pode enviar ao cliente com a ferramenta ${AI_MEDIA_TOOL_NAME} (envie somente quando a regra mandar, no máximo uma vez por arquivo na conversa; escreva também uma frase curta na resposta):\n${lines.join('\n')}`
}

/** The library item a tool call asks for, or `null` when unknown. */
export function parseAiMediaCall(
  items: AiMediaItem[],
  toolCall: AiToolCall,
): AiMediaItem | null {
  if (toolCall.name !== AI_MEDIA_TOOL_NAME) return null
  const key = toolCall.arguments.arquivo
  return typeof key === 'string'
    ? (items.find((item) => item.key === key) ?? null)
    : null
}
