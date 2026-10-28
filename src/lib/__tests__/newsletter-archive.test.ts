import { describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

import { revalidateTag } from 'next/cache'
import { logger } from '@/lib/axiom/logger'
import {
  newsletterArchiveTag,
  revalidateNewsletterArchive,
} from '@/src/lib/newsletter/archive-cache'
import { renderNewsletterRss } from '@/src/lib/newsletter/rss'
import {
  NEWSLETTER_SUCCESS_COPY,
  parseSubscribeResponse,
} from '@/src/lib/newsletter/subscribe-client'
import { issueFrameDocument } from '@/src/lib/newsletter/web-html'
import type { PublicNewsletterFeedDTO } from '@/src/schemas/crm-newsletter-archive.schema'

const feed: PublicNewsletterFeedDTO = {
  workspaceName: 'Acme & Cia',
  workspaceSlug: 'acme',
  newsletter: {
    name: 'Novidades <Acme>',
    slug: 'novidades',
    description: null,
    cadenceLabel: 'Mensal',
    logoUrl: 'https://cdn.acme.com/logo.png',
    primaryColor: '#0055ff',
    doubleOptIn: true,
  },
  issues: [
    {
      number: 2,
      subject: 'Outubro & mais',
      slug: 'outubro',
      excerpt: 'Resumo "curto"',
      sentAt: '2026-10-01T12:00:00.000Z',
    },
    {
      number: 1,
      subject: 'Setembro',
      slug: 'setembro',
      excerpt: null,
      sentAt: '2026-09-01T12:00:00.000Z',
    },
  ],
}

describe('renderNewsletterRss', () => {
  it('should render an RSS 2.0 channel with absolute, escaped links', () => {
    const xml = renderNewsletterRss(feed, 'https://app.steel/')
    expect(xml).toContain('<rss version="2.0"')
    expect(xml).toContain('<title>Novidades &lt;Acme&gt;</title>')
    expect(xml).toContain('<link>https://app.steel/n/acme/novidades</link>')
    expect(xml).toContain(
      'href="https://app.steel/n/acme/novidades/rss.xml" rel="self"',
    )
    expect(xml).toContain(
      'Edições de Novidades &lt;Acme&gt;, de Acme &amp; Cia.',
    )
    expect(xml).toContain(
      '<guid isPermaLink="true">https://app.steel/n/acme/novidades/outubro</guid>',
    )
    expect(xml).toContain('<title>#2 — Outubro &amp; mais</title>')
    expect(xml).toContain('<description>Resumo &quot;curto&quot;</description>')
    expect(xml).toContain('<pubDate>Thu, 01 Oct 2026 12:00:00 GMT</pubDate>')
    expect(xml).toContain('<lastBuildDate>Thu, 01 Oct 2026 12:00:00 GMT')
    expect(xml).toContain('<image><url>https://cdn.acme.com/logo.png</url>')
    // The issue without excerpt has no description.
    expect(xml.match(/<description>/g)).toHaveLength(2)
  })

  it('should render an empty channel without image or build date', () => {
    const xml = renderNewsletterRss(
      {
        ...feed,
        newsletter: { ...feed.newsletter, description: 'Sobre', logoUrl: null },
        issues: [],
      },
      'https://app.steel',
    )
    expect(xml).toContain('<description>Sobre</description>')
    expect(xml).not.toContain('<item>')
    expect(xml).not.toContain('<image>')
    expect(xml).not.toContain('lastBuildDate')
  })
})

describe('issueFrameDocument', () => {
  it('should add the base target right after <head>', () => {
    const html = issueFrameDocument(
      '<html><head lang="x"><title>t</title></head><body>a</body></html>',
    )
    expect(html).toMatch(/^<html><head lang="x"><base target="_blank">/)
    expect(html).toContain('<title>t</title>')
  })

  it('should wrap a fragment in a full document', () => {
    const html = issueFrameDocument('<p>Oi</p>')
    expect(html).toMatch(/^<!doctype html>/)
    expect(html).toContain('<base target="_blank">')
    expect(html).toContain('<body><p>Oi</p></body>')
  })
})

describe('parseSubscribeResponse', () => {
  it('should read requiresConfirmation from the answer', () => {
    expect(
      parseSubscribeResponse(
        200,
        { success: true, data: { requiresConfirmation: false } },
        true,
      ),
    ).toEqual({ ok: true, pending: false })
  })

  it('should read the subscriber status from the answer', () => {
    expect(
      parseSubscribeResponse(
        201,
        { success: true, data: { status: 'PENDING' } },
        false,
      ),
    ).toEqual({ ok: true, pending: true })
    expect(
      parseSubscribeResponse(
        201,
        { success: true, data: { status: 'ACTIVE' } },
        true,
      ),
    ).toEqual({ ok: true, pending: false })
  })

  it("should fall back to the newsletter's double opt-in", () => {
    expect(parseSubscribeResponse(200, { success: true }, true)).toEqual({
      ok: true,
      pending: true,
    })
    expect(
      parseSubscribeResponse(
        200,
        { success: true, data: { status: 'X' } },
        false,
      ),
    ).toEqual({ ok: true, pending: false })
  })

  it('should explain a rate limit', () => {
    const outcome = parseSubscribeResponse(429, null, true)
    expect(outcome.ok).toBe(false)
    expect(outcome.ok ? '' : outcome.message).toMatch(/Muitas tentativas/)
  })

  it('should show validation messages and hide the rest', () => {
    expect(
      parseSubscribeResponse(
        400,
        { success: false, error: { message: 'E-mail inválido' } },
        true,
      ),
    ).toEqual({ ok: false, message: 'E-mail inválido' })
    expect(
      parseSubscribeResponse(400, { success: false, message: 'Dados' }, true),
    ).toEqual({ ok: false, message: 'Dados' })
    const generic = parseSubscribeResponse(
      500,
      { success: false, error: { message: 'stack trace' } },
      true,
    )
    expect(generic.ok ? '' : generic.message).toMatch(/Não foi possível/)
    const empty = parseSubscribeResponse(400, 'oops', true)
    expect(empty.ok ? '' : empty.message).toMatch(/Não foi possível/)
    const success = parseSubscribeResponse(200, { success: false }, true)
    expect(success.ok).toBe(false)
  })

  it('should keep pt-BR success copy for both states', () => {
    expect(NEWSLETTER_SUCCESS_COPY.pending.title).toBe('Confira seu e-mail')
    expect(NEWSLETTER_SUCCESS_COPY.active.title).toBe('Inscrição feita')
  })
})

describe('archive cache', () => {
  it('should build one tag per newsletter', () => {
    expect(newsletterArchiveTag('acme', 'novidades')).toBe(
      'newsletter-archive:acme/novidades',
    )
  })

  it('should expire the tag right away', () => {
    revalidateNewsletterArchive('acme', 'novidades')
    expect(revalidateTag).toHaveBeenCalledWith(
      'newsletter-archive:acme/novidades',
      { expire: 0 },
    )
  })

  it('should only log outside a Next request', () => {
    vi.mocked(revalidateTag).mockImplementationOnce(() => {
      throw new Error('no store')
    })
    expect(() => revalidateNewsletterArchive('a', 'b')).not.toThrow()
    vi.mocked(revalidateTag).mockImplementationOnce(() => {
      throw 'raw'
    })
    revalidateNewsletterArchive('a', 'b')
    expect(logger.warn).toHaveBeenCalledWith(
      'crm.newsletter.archive.revalidate_skipped',
      expect.objectContaining({ cause: 'raw' }),
    )
  })
})
