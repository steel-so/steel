import { describe, expect, it } from 'vitest'
import {
  clickedLink,
  insertBeforeBodyClose,
  isPermanentBounce,
  issueExcerpt,
  isTransientSendError,
  newsletterFooterHtml,
  newsletterFooterText,
  newsletterFromHeader,
  newsletterTags,
  slugifyIssueSubject,
} from '@/src/lib/crm-newsletter/email'

describe('crm-newsletter/email', () => {
  it('builds the From header and neutralizes the name', () => {
    expect(newsletterFromHeader('Acme', 'n@acme.com')).toBe(
      '"Acme" <n@acme.com>',
    )
    expect(newsletterFromHeader('A "b"\r\nc\\', 'n@acme.com')).toBe(
      '"A b c" <n@acme.com>',
    )
    expect(newsletterFromHeader('  ', 'n@acme.com')).toBe('n@acme.com')
  })

  it('renders the footer with links and address, escaped', () => {
    const html = newsletterFooterHtml({
      newsletterName: 'News <1>',
      companyName: 'Acme & Co',
      address: 'Rua A, 1',
      unsubscribeUrl: 'https://x/sair?a=1&b=2',
      preferencesUrl: 'https://x/pref',
    })
    expect(html).toContain('News &lt;1&gt;')
    expect(html).toContain('Acme &amp; Co')
    expect(html).toContain('href="https://x/sair?a=1&amp;b=2"')
    expect(html).toContain('Gerenciar preferências')
    expect(html).toContain('Rua A, 1')

    const bare = newsletterFooterHtml({
      newsletterName: 'N',
      companyName: 'C',
      address: ' ',
    })
    expect(bare).not.toContain('href')

    const text = newsletterFooterText({
      newsletterName: 'N',
      companyName: 'C',
      address: 'Rua A',
      unsubscribeUrl: 'https://x/sair',
      preferencesUrl: 'https://x/pref',
    })
    expect(text).toContain('Cancelar inscrição: https://x/sair')
    expect(text).toContain('Gerenciar preferências: https://x/pref')
    expect(text).toContain('Rua A')
    expect(
      newsletterFooterText({
        newsletterName: 'N',
        companyName: 'C',
        address: '',
      }),
    ).not.toContain('http')
  })

  it('inserts before </body> or appends', () => {
    expect(insertBeforeBodyClose('<body>a</body>', 'X')).toBe('<body>aX</body>')
    expect(insertBeforeBodyClose('<p>a</p>', 'X')).toBe('<p>a</p>X')
  })

  it('builds a clean excerpt', () => {
    expect(
      issueExcerpt('Olá [imagem] {{nome}} veja https://x.com  agora'),
    ).toBe('Olá veja agora')
    const long = 'palavra '.repeat(80)
    const cut = issueExcerpt(long, 50)
    expect(cut.endsWith('…')).toBe(true)
    expect(cut.length).toBeLessThanOrEqual(51)
    expect(issueExcerpt('x'.repeat(100), 10)).toBe(`${'x'.repeat(10)}…`)
  })

  it('tags, slugs and error classes', () => {
    expect(newsletterTags('ab.c')).toEqual([
      { name: 'kind', value: 'newsletter' },
      { name: 'issue', value: 'ab_c' },
    ])
    expect(slugifyIssueSubject('Edição #3: Novidades!')).toBe(
      'edicao-3-novidades',
    )
    expect(slugifyIssueSubject('!')).toBe('edicao')
    expect(isTransientSendError('Too many requests')).toBe(true)
    expect(isTransientSendError('fetch failed')).toBe(true)
    expect(isTransientSendError('Invalid from address')).toBe(false)
  })

  it('reads bounce type and clicked link from the webhook data', () => {
    expect(isPermanentBounce({ bounce: { type: 'Permanent' } })).toBe(true)
    expect(isPermanentBounce({})).toBe(true)
    expect(isPermanentBounce({ bounce: { type: 'Transient' } })).toBe(false)
    expect(clickedLink({ click: { link: 'https://a' } })).toBe('https://a')
    expect(clickedLink({ click: { link: '' } })).toBeNull()
    expect(clickedLink({})).toBeNull()
  })
})
