import { describe, expect, it } from 'vitest'
import {
  buildSourceDescriptionHtml,
  buildSourceDescriptionText,
  buildSourceTitle,
  escapeHtml,
  formatSourceTime,
  isSourceTicketOpen,
  toSourceMessageLine,
} from '@/src/lib/servicedesk/ticket-source'

const at = new Date('2026-11-13T17:05:00.000Z')

describe('toSourceMessageLine', () => {
  it('maps direction and AI to an author', () => {
    const base = { type: 'TEXT', text: ' oi ', createdAt: at }
    expect(
      toSourceMessageLine({ ...base, direction: 'IN', sentByAi: false }),
    ).toEqual({ at, author: 'Cliente', text: 'oi' })
    expect(
      toSourceMessageLine({ ...base, direction: 'OUT', sentByAi: false })
        ?.author,
    ).toBe('Atendente')
    expect(
      toSourceMessageLine({ ...base, direction: 'OUT', sentByAi: true })
        ?.author,
    ).toBe('IA')
  })

  it('labels media without text and drops empty unknown types', () => {
    const base = { direction: 'IN' as const, sentByAi: false, createdAt: at }
    expect(
      toSourceMessageLine({ ...base, type: 'IMAGE', text: null })?.text,
    ).toBe('[imagem]')
    expect(toSourceMessageLine({ ...base, type: 'X', text: '  ' })).toBeNull()
  })

  it('clips very long messages', () => {
    const line = toSourceMessageLine({
      direction: 'IN',
      sentByAi: false,
      createdAt: at,
      type: 'TEXT',
      text: 'a'.repeat(900),
    })
    expect(line?.text).toHaveLength(600)
    expect(line?.text.endsWith('…')).toBe(true)
  })
})

describe('formatSourceTime', () => {
  it('formats in the given time zone, not the server one', () => {
    expect(formatSourceTime(at, 'America/Sao_Paulo')).toBe('13/11/2026 14:05')
    expect(formatSourceTime(at, 'UTC')).toBe('13/11/2026 17:05')
  })
})

describe('buildSourceTitle', () => {
  it('uses the last customer text for a conversation', () => {
    expect(
      buildSourceTitle({
        source: 'conversation',
        label: 'Ana',
        lastCustomerText: 'Não consigo\nacessar o sistema',
      }),
    ).toBe('Ana: Não consigo acessar o sistema')
  })

  it('falls back when there is no text', () => {
    expect(buildSourceTitle({ source: 'conversation', label: 'Ana' })).toBe(
      'Atendimento no WhatsApp: Ana',
    )
  })

  it('names CRM sources and caps at 200 characters', () => {
    expect(buildSourceTitle({ source: 'lead', label: 'Acme' })).toBe(
      'Chamado do lead Acme',
    )
    expect(buildSourceTitle({ source: 'person', label: 'Bia' })).toBe(
      'Chamado de Bia',
    )
    expect(buildSourceTitle({ source: 'opportunity', label: 'Plano' })).toBe(
      'Chamado da oportunidade Plano',
    )
    expect(buildSourceTitle({ source: 'person', label: '' })).toBe(
      'Chamado de sem nome',
    )
    const long = buildSourceTitle({
      source: 'conversation',
      label: 'x'.repeat(500),
      lastCustomerText: 'y'.repeat(500),
    })
    expect(long.length).toBeLessThanOrEqual(200)
  })
})

describe('description', () => {
  const input = {
    source: 'conversation' as const,
    sourceLabel: 'Ana <script>',
    details: [{ label: 'Telefone', value: '+55 11 98888-7777' }],
    note: 'Cliente urgente\n\nLigar antes',
    messages: [{ at, author: 'Cliente' as const, text: 'Oi & tchau' }],
    timeZone: 'America/Sao_Paulo',
  }

  it('builds escaped HTML with note, origin, details and quote', () => {
    const html = buildSourceDescriptionHtml(input)
    expect(html).toContain('<p>Cliente urgente</p><p>Ligar antes</p>')
    expect(html).toContain('Conversa do WhatsApp — Ana &lt;script&gt;')
    expect(html).toContain('<li><strong>Telefone:</strong> +55 11 98888-7777</li>')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('13/11/2026 14:05')
    expect(html).toContain('Oi &amp; tchau')
    expect(html).not.toContain('<script>')
  })

  it('omits optional blocks', () => {
    const html = buildSourceDescriptionHtml({
      ...input,
      source: 'lead',
      note: null,
      details: [],
      messages: [],
    })
    expect(html).toBe(
      '<p><strong>Origem:</strong> Lead do CRM — Ana &lt;script&gt;</p>',
    )
  })

  it('renders the same content as text', () => {
    const text = buildSourceDescriptionText(input)
    expect(text).toContain('Cliente urgente')
    expect(text).toContain('Telefone: +55 11 98888-7777')
    expect(text).toContain('13/11/2026 14:05 Cliente: Oi & tchau')
    expect(
      buildSourceDescriptionText({
        ...input,
        note: undefined,
        messages: [],
        details: [],
      }),
    ).toBe('Origem: Conversa do WhatsApp — Ana <script>')
  })

  it('keeps line breaks inside a note paragraph', () => {
    const html = buildSourceDescriptionHtml({
      ...input,
      note: 'a\nb',
      messages: [],
      details: [],
    })
    expect(html.startsWith('<p>a<br>b</p>')).toBe(true)
  })
})

describe('helpers', () => {
  it('escapes HTML', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    )
  })

  it('tells open phases from done ones', () => {
    expect(isSourceTicketOpen('NEW')).toBe(true)
    expect(isSourceTicketOpen('WAITING')).toBe(true)
    for (const done of ['RESOLVED', 'CLOSED', 'CANCELED']) {
      expect(isSourceTicketOpen(done)).toBe(false)
    }
  })
})
