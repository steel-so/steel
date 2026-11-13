import { describe, expect, it } from 'vitest'
import {
  buildReplyKnowledgeSection,
  customerQueryText,
  REPLY_KNOWLEDGE_CHAR_BUDGET,
  REPLY_KNOWLEDGE_MAX_SOURCES,
  REPLY_KNOWLEDGE_QUERY_MAX,
  REPLY_KNOWLEDGE_SOURCE_CHARS,
} from '../whatsapp/reply-knowledge'

describe('customerQueryText', () => {
  const history = [
    { direction: 'IN', text: 'primeira' },
    { direction: 'OUT', text: 'resposta do atendente' },
    { direction: 'IN', text: '  segunda  ' },
    { direction: 'IN', text: null },
    { direction: 'IN', text: 'terceira' },
  ]

  it('should join the last customer messages, oldest first', () => {
    expect(customerQueryText(history)).toBe('segunda terceira')
  })

  it('should read a newest-first list in chronological order', () => {
    expect(customerQueryText(history.slice().reverse(), 'newest-first')).toBe(
      'segunda terceira',
    )
  })

  it('should ignore outbound and blank messages', () => {
    expect(
      customerQueryText([
        { direction: 'OUT', text: 'oi' },
        { direction: 'IN', text: '   ' },
      ]),
    ).toBe('')
  })

  it('should cap the query length', () => {
    const long = [{ direction: 'IN', text: 'a'.repeat(2000) }]
    expect(customerQueryText(long)).toHaveLength(REPLY_KNOWLEDGE_QUERY_MAX)
  })
})

describe('buildReplyKnowledgeSection', () => {
  const entry = (n: number, text = `texto ${n}`) => ({
    sourceLabel: 'Página da Wiki',
    title: `Título ${n}`,
    text,
  })

  it('should return an empty string without usable entries', () => {
    expect(buildReplyKnowledgeSection([], 'customer')).toBe('')
    expect(buildReplyKnowledgeSection([entry(1, '   ')], 'agent')).toBe('')
  })

  it('should fence each source as untrusted data', () => {
    const section = buildReplyKnowledgeSection([entry(1)], 'customer')
    expect(section).toContain('### Página da Wiki: Título 1')
    expect(section).toContain('<untrusted_content source="knowledge_document">')
    expect(section).toContain('texto 1')
  })

  it('should tell the model not to cite links to customers only', () => {
    expect(buildReplyKnowledgeSection([entry(1)], 'customer')).toContain(
      'não cite links',
    )
    expect(buildReplyKnowledgeSection([entry(1)], 'agent')).not.toContain(
      'não cite links',
    )
  })

  it('should keep at most the maximum number of sources', () => {
    const section = buildReplyKnowledgeSection(
      [entry(1), entry(2), entry(3), entry(4), entry(5)],
      'agent',
    )
    expect(section.match(/^### /gm)).toHaveLength(REPLY_KNOWLEDGE_MAX_SOURCES)
  })

  it('should trim each source and respect the total budget', () => {
    const big = 'x'.repeat(REPLY_KNOWLEDGE_SOURCE_CHARS * 3)
    const section = buildReplyKnowledgeSection(
      [entry(1, big), entry(2, big), entry(3, big)],
      'agent',
    )
    const xs = section.match(/x/g)?.length ?? 0
    expect(xs).toBeLessThanOrEqual(REPLY_KNOWLEDGE_CHAR_BUDGET)
    expect(xs).toBeGreaterThanOrEqual(REPLY_KNOWLEDGE_SOURCE_CHARS)
  })

  it('should stop once the budget is spent', () => {
    const chunk = 'y'.repeat(REPLY_KNOWLEDGE_SOURCE_CHARS)
    const section = buildReplyKnowledgeSection(
      [entry(1, chunk), entry(2, chunk), entry(3, chunk)],
      'agent',
    )
    expect(section.match(/^### /gm)?.length).toBeLessThanOrEqual(3)
    expect(section.match(/y/g)?.length).toBeLessThanOrEqual(
      REPLY_KNOWLEDGE_CHAR_BUDGET,
    )
  })
})
