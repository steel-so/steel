import { describe, expect, it } from 'vitest'
import {
  newsletterArchivePage,
  newsletterNotFoundHtml,
} from '@/src/lib/newsletter/archive-route'

describe('newsletterArchivePage', () => {
  it('matches the archive home and issue pages', () => {
    expect(newsletterArchivePage('/n/acme/novidades')).toEqual({
      workspaceSlug: 'acme',
      newsletterSlug: 'novidades',
    })
    expect(newsletterArchivePage('/n/acme/novidades/')).toEqual({
      workspaceSlug: 'acme',
      newsletterSlug: 'novidades',
    })
    expect(newsletterArchivePage('/n/acme/novidades/edicao-1')).toEqual({
      workspaceSlug: 'acme',
      newsletterSlug: 'novidades',
      issueSlug: 'edicao-1',
    })
    expect(newsletterArchivePage('/n/acme/novidades/ol%C3%A1')?.issueSlug).toBe(
      'olá',
    )
  })

  it('ignores the RSS feed, other paths and malformed segments', () => {
    expect(newsletterArchivePage('/n/acme/novidades/rss.xml')).toBeNull()
    expect(newsletterArchivePage('/n/acme')).toBeNull()
    expect(newsletterArchivePage('/n/a/b/c/d')).toBeNull()
    expect(newsletterArchivePage('/newsletter/sair/x')).toBeNull()
    expect(newsletterArchivePage('/s/acme/novidades')).toBeNull()
    expect(newsletterArchivePage('/n/%E0%A4%A/novidades')).toBeNull()
  })

  it('renders a pt-BR noindex page', () => {
    const html = newsletterNotFoundHtml()
    expect(html).toContain('lang="pt-BR"')
    expect(html).toContain('Newsletter não encontrada')
    expect(html).toContain('noindex')
  })
})
