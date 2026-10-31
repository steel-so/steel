import { describe, expect, it } from 'vitest'
import { escapeHtml, ticketDescriptionHtml } from '../src/lib/html'
import { contact } from './helpers'

describe('escapeHtml', () => {
  it('escapes markup', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
  })
})

describe('ticketDescriptionHtml', () => {
  it('writes the note and the contact with the identifiers the history search uses', () => {
    const html = ticketDescriptionHtml(
      contact({
        emails: ['Ana@X.com'],
        linkedin: 'https://www.linkedin.com/in/ana',
      }),
      'Linha 1\nlinha 2\n\n<b>Segundo</b>',
    )
    expect(html).toContain('<p>Linha 1<br>linha 2</p>')
    expect(html).toContain('<p>&lt;b&gt;Segundo&lt;/b&gt;</p>')
    expect(html).toContain('Origem: WhatsApp Web<br>Contato: Maria Silva<br>Telefone: 551112345678')
    expect(html).toContain('E-mail: ana@x.com<br>LinkedIn: ana')
    expect(html).toContain('Aberto pela extensão do Steel.')
  })

  it('works with an empty note and no contact', () => {
    expect(ticketDescriptionHtml(null, '  ')).toBe('<p><em>Aberto pela extensão do Steel.</em></p>')
  })

  it('keeps a phone it cannot normalize and omits a missing name', () => {
    const html = ticketDescriptionHtml(contact({ name: null, phones: ['12'] }), '')
    expect(html).toContain('Telefone: 12')
    expect(html).not.toContain('Contato:')
  })
})
