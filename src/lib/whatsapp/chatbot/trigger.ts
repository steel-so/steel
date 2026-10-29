import type { ChatbotTrigger } from '@/src/schemas/whatsapp-chatbot.schema'
import { normalizeAnswer } from './text'

/** `true` when any keyword appears as whole words in the message. */
export function matchesKeyword(text: string, keywords: string[]): boolean {
  const haystack = ` ${normalizeAnswer(text)} `
  return keywords.some((keyword) => {
    const needle = normalizeAnswer(keyword)
    return needle !== '' && haystack.includes(` ${needle} `)
  })
}

export interface TriggerFacts {
  /** The message opened the conversation (new or reopened). */
  opening: boolean
  text: string
  /** The workspace has business hours on and they are closed right now. */
  outsideBusinessHours: boolean
}

/** Whether a bot with this trigger should start for the message. */
export function shouldStartBot(
  bot: { triggerKind: ChatbotTrigger; keywords: string[] },
  facts: TriggerFacts,
): boolean {
  switch (bot.triggerKind) {
    case 'NEW_CONVERSATION':
      return facts.opening
    case 'KEYWORD':
      return matchesKeyword(facts.text, bot.keywords)
    case 'OUTSIDE_BUSINESS_HOURS':
      return facts.opening && facts.outsideBusinessHours
  }
}
