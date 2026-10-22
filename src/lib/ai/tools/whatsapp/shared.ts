import { z } from 'zod'
import { type AppError, validationError } from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'
import { formatWaId } from '@/src/lib/whatsapp/phone'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import type { WhatsAppConversationDTO } from '@/types/whatsapp-conversation'
import type { WhatsAppMessageDTO } from '@/types/whatsapp-message'

/**
 * Shared helpers of the Comunicação (WhatsApp) Steel AI tools: argument
 * parsing, pagination, deep links and the compact shapes sent to the model.
 */

export const DEFAULT_LIMIT = 20
export const MAX_LIMIT = 50
/** Long texts are cut so a tool result stays under the ~20 KB budget. */
export const MAX_TEXT_CHARS = 1000

export function zodParser<T>(schema: z.ZodType<T>) {
  return (args: Record<string, unknown>): Result<T, AppError> => {
    const parsed = schema.safeParse(args ?? {})
    if (parsed.success) return ok(parsed.data)
    return err(
      validationError(
        'Argumentos inválidos para a ferramenta',
        parsed.error.issues,
      ),
    )
  }
}

export const idSchema = z.string().trim().min(1).max(64)

export const limitSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(MAX_LIMIT)
  .default(DEFAULT_LIMIT)

export const offsetSchema = z.coerce.number().int().min(0).default(0)

export const limitParameter = {
  type: 'integer',
  minimum: 1,
  maximum: MAX_LIMIT,
  description: `Quantidade máxima de itens (padrão ${DEFAULT_LIMIT}, máximo ${MAX_LIMIT}).`,
}

export const offsetParameter = {
  type: 'integer',
  minimum: 0,
  description: 'Quantos itens pular (paginação; padrão 0).',
}

export interface Page<T> {
  total: number
  offset: number
  limit: number
  hasMore: boolean
  items: T[]
}

export function paginate<T>(
  items: readonly T[],
  offset: number,
  limit: number,
): Page<T> {
  return {
    total: items.length,
    offset,
    limit,
    hasMore: offset + limit < items.length,
    items: items.slice(offset, offset + limit),
  }
}

export function truncate(
  text: string | null | undefined,
  max = MAX_TEXT_CHARS,
): string | null {
  if (!text) return null
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** pt-BR case/diacritics-insensitive "contains". */
export function matches(
  haystack: string | null | undefined,
  needle: string,
): boolean {
  if (!haystack) return false
  const normalize = (value: string) =>
    value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('pt-BR')
  return normalize(haystack).includes(normalize(needle))
}

/** Base path of the module UI (`/<slug>/zap`) for deep links. */
export async function zapBasePath(
  workspaceId: string,
): Promise<Result<string>> {
  const workspace = await WorkspaceRepository.findById(workspaceId)
  if (!workspace.ok) return workspace
  return ok(`/${workspace.value.slug}/zap`)
}

export function conversationHref(base: string, id: string): string {
  return `${base}?conversa=${id}`
}

export const ZAP_PAGES = {
  contacts: '/contatos',
  quickReplies: '/mensagens-rapidas',
  broadcasts: '/transmissoes',
  templates: '/templates',
  groups: '/grupos',
  settings: '/configuracoes',
} as const

export const STATUS_LABELS: Record<WhatsAppConversationDTO['status'], string> =
  {
    NEW: 'Nova',
    IN_PROGRESS: 'Em atendimento',
    CLOSED: 'Encerrada',
  }

export function contactLabel(conversation: {
  contactName: string | null
  contactWaId: string
}): string {
  return conversation.contactName
    ? `${conversation.contactName} (${formatWaId(conversation.contactWaId)})`
    : formatWaId(conversation.contactWaId)
}

export function compactConversation(
  conversation: WhatsAppConversationDTO,
  base: string,
  memberNames: ReadonlyMap<string, string>,
) {
  return {
    id: conversation.id,
    contact: contactLabel(conversation),
    contactId: conversation.contactId,
    connectionId: conversation.connectionId,
    status: conversation.status,
    assignedUserId: conversation.assignedUserId,
    assignedTo: conversation.assignedUserId
      ? (memberNames.get(conversation.assignedUserId) ?? null)
      : null,
    aiActive: conversation.aiActive,
    unreadCount: conversation.unreadCount,
    sentimentScore: conversation.avgSentimentScore,
    lastMessageAt: conversation.lastMessageAt,
    lastMessagePreview: truncate(conversation.lastMessagePreview, 200),
    archived: conversation.archived,
    closedAt: conversation.closedAt,
    href: conversationHref(base, conversation.id),
  }
}

/** Text only: media becomes its type plus the caption (stored as text). */
export function compactMessage(message: WhatsAppMessageDTO) {
  const author =
    message.direction === 'IN'
      ? 'cliente'
      : message.sentByAi
        ? 'ia'
        : 'atendente'
  const isText = message.type === 'TEXT' || message.type === 'BUTTON'
  return {
    id: message.id,
    at: message.createdAt,
    author,
    type: message.type,
    ...(isText
      ? { text: truncate(message.text) }
      : { caption: truncate(message.text) }),
    ...(message.direction === 'OUT' ? { status: message.status } : {}),
  }
}

/** Average sentiment at or below this counts as negative (alert default). */
export const NEGATIVE_SENTIMENT_THRESHOLD = -0.3
