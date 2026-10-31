import type {
  QaConversationSource,
  QaTicketSource,
} from '@/src/repositories/qa-review-source.repository'
import type { QaHandlerKindDTO } from '@/types/qa-review'
import type { QaTranscriptLine } from './prompts'

export interface QaTranscript {
  lines: QaTranscriptLine[]
  /** null = nobody answered the customer. */
  handlerKind: QaHandlerKindDTO | null
  /** Lines said by the customer or the attendance (internal notes excluded). */
  messageCount: number
  /** Human who answered the most, when the subject has no owner. */
  fallbackAgentId: string | null
}

const MESSAGE_TEXT_MAX = 1_200

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > MESSAGE_TEXT_MAX
    ? `${flat.slice(0, MESSAGE_TEXT_MAX)}…`
    : flat
}

/** Tags and entities out of the rich-text description of a ticket. */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function handlerOf(bot: number, human: number): QaHandlerKindDTO | null {
  if (bot === 0 && human === 0) return null
  if (human === 0) return 'BOT'
  if (bot === 0) return 'HUMAN'
  return 'MIXED'
}

function mostFrequent(ids: string[]): string | null {
  const counts = new Map<string, number>()
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
  let best: string | null = null
  let bestCount = 0
  for (const [id, count] of counts) {
    if (count > bestCount) {
      best = id
      bestCount = count
    }
  }
  return best
}

export function buildConversationTranscript(
  source: QaConversationSource,
): QaTranscript {
  const lines: QaTranscriptLine[] = []
  const humanSenders: string[] = []
  let bot = 0
  let human = 0
  for (const message of source.messages) {
    const text = clip(message.text)
    if (!text) continue
    if (message.direction === 'IN') {
      lines.push({ role: 'customer', text })
    } else if (message.sentByAi || !message.senderUserId) {
      // An OUT message with no author is automation (chatbot, flow, button).
      bot++
      lines.push({ role: 'bot', text })
    } else {
      human++
      humanSenders.push(message.senderUserId)
      lines.push({ role: 'human', text })
    }
  }
  return {
    lines,
    handlerKind: handlerOf(bot, human),
    messageCount: lines.length,
    fallbackAgentId: mostFrequent(humanSenders),
  }
}

export function buildTicketTranscript(source: QaTicketSource): QaTranscript {
  const lines: QaTranscriptLine[] = []
  const humanSenders: string[] = []
  let bot = 0
  let human = 0
  let messageCount = 0
  const opening = source.description ? clip(stripHtml(source.description)) : ''
  if (opening) {
    lines.push({ role: 'customer', text: `Abertura do chamado: ${opening}` })
    messageCount++
  }
  for (const message of source.messages) {
    if (message.authorKind === 'SYSTEM') continue
    const text = clip(message.body)
    if (!text) continue
    if (
      message.authorKind === 'REQUESTER' ||
      message.authorKind === 'CONTACT'
    ) {
      lines.push({ role: 'customer', text })
      messageCount++
    } else if (message.visibility === 'INTERNAL') {
      lines.push({ role: 'internal', text })
    } else if (message.authorKind === 'AI') {
      bot++
      messageCount++
      lines.push({ role: 'bot', text })
    } else {
      human++
      messageCount++
      if (message.authorUserId) humanSenders.push(message.authorUserId)
      lines.push({ role: 'human', text })
    }
  }
  return {
    lines,
    handlerKind: handlerOf(bot, human),
    messageCount,
    fallbackAgentId: mostFrequent(humanSenders),
  }
}
