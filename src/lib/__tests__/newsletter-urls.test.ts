import { describe, expect, it } from 'vitest'
import {
  emailDomain,
  newsletterArchiveUrl,
  newsletterConfirmUrl,
  newsletterIssueUrl,
  newsletterPreferencesUrl,
  newsletterRssUrl,
  newsletterUnsubscribeHeaders,
  newsletterUnsubscribeUrls,
} from '../newsletter/urls'

const BASE = 'https://steel.example/'

describe('newsletter urls', () => {
  it('builds the public archive, issue and feed paths', () => {
    expect(newsletterArchiveUrl(BASE, 'acme', 'boletim')).toBe(
      'https://steel.example/n/acme/boletim',
    )
    expect(newsletterIssueUrl(BASE, 'acme', 'boletim', 'outubro')).toBe(
      'https://steel.example/n/acme/boletim/outubro',
    )
    expect(newsletterRssUrl(BASE, 'acme', 'boletim')).toBe(
      'https://steel.example/n/acme/boletim/rss.xml',
    )
  })

  it('builds the token pages and the one-click headers', () => {
    expect(newsletterConfirmUrl(BASE, 't')).toBe(
      'https://steel.example/newsletter/confirmar/t',
    )
    expect(newsletterPreferencesUrl(BASE, 't')).toBe(
      'https://steel.example/newsletter/preferencias/t',
    )
    const urls = newsletterUnsubscribeUrls(BASE, 't')
    expect(urls).toEqual({
      pageUrl: 'https://steel.example/newsletter/sair/t',
      oneClickUrl: 'https://steel.example/api/newsletters/unsubscribe/t',
    })
    expect(newsletterUnsubscribeHeaders(urls)).toEqual({
      'List-Unsubscribe':
        '<https://steel.example/api/newsletters/unsubscribe/t>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    })
  })

  it('extracts the lower-case domain of an address', () => {
    expect(emailDomain('Ana@News.Acme.com ')).toBe('news.acme.com')
    expect(emailDomain('no-at-sign')).toBe('')
  })
})
