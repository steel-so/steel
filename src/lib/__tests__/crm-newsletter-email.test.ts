import { describe, expect, it } from 'vitest'
import {
  clickedLink,
  insertBeforeBodyClose,
  isPermanentBounce,
  issueExcerpt,
  isTransientSendError,
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
