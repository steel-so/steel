import { describe, expect, it } from 'vitest'
import {
  buildConversationTranscript,
  buildTicketTranscript,
  stripHtml,
} from '../qa/transcript'

const conv = (messages: object[]) =>
  ({
    id: 'c1',
    assignedUserId: null,
    assignedUserName: null,
    customerName: 'Ana',
    endedAt: null,
    messages,
  }) as never

const ticket = (messages: object[], description: string | null = null) =>
  ({
    id: 't1',
    label: '#1 Erro',
    description,
    assigneeId: null,
    assigneeName: null,
    customerName: null,
    endedAt: null,
    messages,
  }) as never

const msg = (
  direction: 'IN' | 'OUT',
  text: string,
  senderUserId: string | null = null,
  sentByAi = false,
) => ({ direction, text, senderUserId, sentByAi })

const tmsg = (
  authorKind: string,
  visibility: string,
  body: string,
  authorUserId: string | null = null,
) => ({ authorKind, visibility, body, authorUserId })

describe('stripHtml', () => {
  it('drops tags and decodes the basic entities', () => {
    expect(stripHtml('<p>A&nbsp;&amp; B &lt;c&gt;</p>')).toBe('A & B <c>')
  })
})

describe('buildConversationTranscript', () => {
  it('classifies customer, human and bot lines', () => {
    const result = buildConversationTranscript(
      conv([
        msg('IN', 'Oi'),
        msg('OUT', 'Bot', null, true),
        msg('OUT', 'Menu'),
        msg('OUT', 'Olá', 'u1'),
        msg('OUT', 'Sim', 'u1'),
        msg('OUT', 'Ok', 'u2'),
        msg('IN', '   '),
      ]),
    )
    expect(result.lines.map((l) => l.role)).toEqual([
      'customer',
      'bot',
      'bot',
      'human',
      'human',
      'human',
    ])
    expect(result.handlerKind).toBe('MIXED')
    expect(result.messageCount).toBe(6)
    expect(result.fallbackAgentId).toBe('u1')
  })

  it('detects bot-only, human-only and unanswered attendances', () => {
    const botOnly = [msg('OUT', 'a', null, true)]
    const humanOnly = [msg('OUT', 'a', 'u1')]
    expect(buildConversationTranscript(conv(botOnly)).handlerKind).toBe('BOT')
    expect(buildConversationTranscript(conv(humanOnly)).handlerKind).toBe(
      'HUMAN',
    )
    const none = buildConversationTranscript(conv([msg('IN', 'a')]))
    expect(none.handlerKind).toBeNull()
    expect(none.fallbackAgentId).toBeNull()
  })

  it('clips very long messages', () => {
    const result = buildConversationTranscript(
      conv([msg('IN', 'x'.repeat(3_000))]),
    )
    expect(result.lines[0].text.endsWith('…')).toBe(true)
  })
})

describe('buildTicketTranscript', () => {
  it('opens with the description and maps the author kinds', () => {
    const result = buildTicketTranscript(
      ticket(
        [
          tmsg('SYSTEM', 'PUBLIC', 'sys'),
          tmsg('REQUESTER', 'PUBLIC', 'Ajuda'),
          tmsg('CONTACT', 'PUBLIC', 'Ainda'),
          tmsg('AGENT', 'INTERNAL', 'nota', 'u1'),
          tmsg('AI', 'PUBLIC', 'Sugestão'),
          tmsg('AGENT', 'PUBLIC', 'Feito', 'u1'),
          tmsg('AGENT', 'PUBLIC', 'Feito 2'),
          tmsg('AGENT', 'PUBLIC', '  ', 'u1'),
        ],
        '<p>Não liga</p>',
      ),
    )
    expect(result.lines.map((l) => l.role)).toEqual([
      'customer',
      'customer',
      'customer',
      'internal',
      'bot',
      'human',
      'human',
    ])
    expect(result.lines[0].text).toBe('Abertura do chamado: Não liga')
    expect(result.handlerKind).toBe('MIXED')
    // The internal note is not part of the attendance count.
    expect(result.messageCount).toBe(6)
    expect(result.fallbackAgentId).toBe('u1')
  })

  it('works without a description', () => {
    const result = buildTicketTranscript(ticket([]))
    expect(result.lines).toEqual([])
    expect(result.handlerKind).toBeNull()
  })
})
