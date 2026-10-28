import { describe, expect, it } from 'vitest'
import {
  createFakeArchiveIssueRow,
  createFakeArchiveNewsletterRow,
  createFakeSiteNewsletterRow,
} from '@/src/__tests__/factories/newsletter-archive.factory'
import {
  toPublicArchiveNewsletter,
  toPublicIssueSummary,
  toSiteNewsletterOption,
} from '../crm-newsletter-archive.mapper'

describe('crm-newsletter-archive mapper', () => {
  it('should map the newsletter with the e-mail brand', () => {
    expect(toPublicArchiveNewsletter(createFakeArchiveNewsletterRow())).toEqual(
      {
        name: 'Novidades Acme',
        slug: 'novidades',
        description: 'O que acontece na Acme, todo mês.',
        cadenceLabel: 'Mensal',
        logoUrl: 'https://cdn.acme.com/logo.png',
        primaryColor: '#0055ff',
        doubleOptIn: true,
      },
    )
  })

  it('should turn blank fields and a missing brand into null', () => {
    const row = createFakeArchiveNewsletterRow({
      description: '  ',
      cadenceLabel: null,
      workspace: { name: 'Acme', slug: 'acme', crmEmailBrand: null },
    })
    expect(toPublicArchiveNewsletter(row)).toMatchObject({
      description: null,
      cadenceLabel: null,
      logoUrl: null,
      primaryColor: null,
    })
    const emptyBrand = createFakeArchiveNewsletterRow({
      workspace: {
        name: 'Acme',
        slug: 'acme',
        crmEmailBrand: { logoUrl: '', primaryColor: ' ' },
      },
    })
    expect(toPublicArchiveNewsletter(emptyBrand)).toMatchObject({
      logoUrl: null,
      primaryColor: null,
    })
  })

  it('should map an issue summary with ISO dates', () => {
    expect(toPublicIssueSummary(createFakeArchiveIssueRow())).toEqual({
      number: 1,
      subject: 'Edição de outubro',
      slug: 'edicao-de-outubro',
      excerpt: 'Resumo da edição.',
      sentAt: '2026-10-01T12:00:00.000Z',
    })
  })

  it('should fall back when number, date or excerpt are missing', () => {
    expect(
      toPublicIssueSummary(
        createFakeArchiveIssueRow({ number: null, sentAt: null, excerpt: ' ' }),
      ),
    ).toMatchObject({
      number: 0,
      sentAt: '1970-01-01T00:00:00.000Z',
      excerpt: null,
    })
  })

  it('should map a site newsletter with its absolute archive URL', () => {
    const option = toSiteNewsletterOption(
      createFakeSiteNewsletterRow({ id: 'n1' }),
      'https://app.steel/',
    )
    expect(option).toMatchObject({
      id: 'n1',
      workspaceSlug: 'acme',
      slug: 'novidades',
      archiveEnabled: true,
      archiveUrl: 'https://app.steel/n/acme/novidades',
    })
    expect(option.issues).toHaveLength(1)
  })

  it('should list no issue when the archive is off', () => {
    const option = toSiteNewsletterOption(
      createFakeSiteNewsletterRow({ archiveEnabled: false }),
      'https://app.steel',
    )
    expect(option.issues).toEqual([])
  })
})
