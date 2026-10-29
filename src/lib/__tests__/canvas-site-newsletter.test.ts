import { describe, expect, it } from 'vitest'
import {
  renderSite,
  renderSiteEditing,
  siteDoc,
} from '@/src/__tests__/helpers/site-canvas'
import { validateDocument } from '@/src/lib/canvas/ops'
import { siteCatalog } from '@/src/lib/canvas-site/catalog'
import { SITE_TYPES } from '@/src/lib/canvas-site/constants'
import type { SiteRenderContext } from '@/src/lib/canvas-site/context'
import { compileSiteCss } from '@/src/lib/canvas-site/css'
import { spec } from '@/src/lib/canvas-site/presets/builder'
import {
  siteRuntimeFeatures,
  siteRuntimeScripts,
} from '@/src/lib/canvas-site/runtime'
import { collectNewsletterIds } from '@/src/lib/sites/document'
import type { SiteLiveNewsletter } from '@/src/schemas/crm-newsletter-archive.schema'

const live: SiteLiveNewsletter = {
  workspaceSlug: 'acme',
  slug: 'novidades',
  name: 'Novidades',
  doubleOptIn: true,
  archiveEnabled: true,
  archiveUrl: 'https://app.steel/n/acme/novidades',
  issues: [
    {
      number: 2,
      subject: 'Outubro',
      slug: 'outubro',
      excerpt: 'Resumo de outubro',
      // 02:00 UTC is still Sept 30 in São Paulo.
      sentAt: '2026-10-01T02:00:00.000Z',
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

const context: SiteRenderContext = {
  newsletters: { nl1: live },
  siteId: 'site1',
}

const subscribe = (props: Record<string, unknown> = {}) =>
  spec(SITE_TYPES.newsletterSubscribe, { newsletterId: 'nl1', ...props })
const issues = (props: Record<string, unknown> = {}) =>
  spec(SITE_TYPES.newsletterIssues, { newsletterId: 'nl1', ...props })

describe('site.newsletter-subscribe', () => {
  it('should render the form wired to the subscribe endpoint', () => {
    const html = renderSite(
      siteDoc([subscribe({ showName: true, title: 'Assine já' })]),
      context,
    )
    expect(html).toContain('data-site-newsletter=""')
    expect(html).toContain('action="/api/newsletters/subscribe"')
    expect(html).toContain('data-workspace="acme"')
    expect(html).toContain('data-newsletter="novidades"')
    expect(html).toContain('data-site="site1"')
    expect(html).toContain('data-double-opt-in="true"')
    expect(html).toContain('name="email"')
    expect(html).toContain('name="name"')
    expect(html).toContain('name="website"')
    expect(html).toContain('Quero receber esta newsletter por e-mail')
    expect(html).toContain('Assine já')
  })

  it('should hide the title and the name field when off', () => {
    const html = renderSite(
      siteDoc([subscribe({ title: '', showName: false, submitLabel: '' })]),
      { newsletters: { nl1: { ...live, doubleOptIn: false } } },
    )
    expect(html).not.toContain('s-nl-title')
    expect(html).not.toContain('name="name"')
    expect(html).toContain('data-double-opt-in="false"')
    expect(html).toContain('>Assinar</button>')
  })

  it('should render nothing for a missing newsletter on the published page', () => {
    expect(
      renderSite(siteDoc([subscribe({ newsletterId: 'gone' })])),
    ).not.toContain('data-site-newsletter')
    expect(
      renderSite(siteDoc([subscribe({ newsletterId: '' })])),
    ).not.toContain('data-site-newsletter')
  })

  it('should show a hint in the editor', () => {
    expect(
      renderSiteEditing(siteDoc([subscribe({ newsletterId: '' })])),
    ).toContain('escolha uma newsletter do CRM')
    expect(
      renderSiteEditing(siteDoc([subscribe({ newsletterId: 'gone' })])),
    ).toContain('não está mais ativa')
  })
})

describe('site.newsletter-issues', () => {
  it('should list the latest issues with absolute links in the site timezone', () => {
    const html = renderSite(siteDoc([issues({ count: 5 })]), context)
    expect(html).toContain('href="https://app.steel/n/acme/novidades/outubro"')
    expect(html).toContain('#2')
    expect(html).toContain('30 de setembro de 2026')
    expect(html).toContain('Resumo de outubro')
    expect(html).toContain('href="https://app.steel/n/acme/novidades"')
    expect(html).toContain('Ver todas as edições')

    const utc = renderSite(siteDoc([issues()]), { ...context, timeZone: 'UTC' })
    expect(utc).toContain('1 de outubro de 2026')
  })

  it('should honour count, list layout and the hidden parts', () => {
    const html = renderSite(
      siteDoc([
        issues({
          count: 1,
          layout: 'list',
          showNumber: false,
          showDate: false,
          showExcerpt: false,
          showArchiveLink: false,
        }),
      ]),
      context,
    )
    expect(html).toContain('s-nl-list')
    expect(html).toContain('Outubro')
    expect(html).not.toContain('Setembro')
    expect(html).not.toContain('s-nl-meta')
    expect(html).not.toContain('Resumo de outubro')
    expect(html).not.toContain('s-nl-all')
  })

  it('should show the number or the date alone', () => {
    const numberOnly = renderSite(
      siteDoc([issues({ showDate: false })]),
      context,
    )
    expect(numberOnly).toContain('#2')
    expect(numberOnly).not.toContain('<time')
    const dateOnly = renderSite(
      siteDoc([issues({ showNumber: false })]),
      context,
    )
    expect(dateOnly).not.toContain('#2')
    expect(dateOnly).toContain('<time')
  })

  it('should show the empty text, or nothing without one', () => {
    const empty = { newsletters: { nl1: { ...live, issues: [] } } }
    expect(renderSite(siteDoc([issues()]), empty)).toContain(
      'A primeira edição sai em breve.',
    )
    expect(
      renderSite(siteDoc([issues({ emptyText: '' })]), empty),
    ).not.toContain('s-nl-issues')
  })

  it('should drop the links when the archive is off', () => {
    const html = renderSite(siteDoc([issues({ archiveLinkLabel: '' })]), {
      newsletters: { nl1: { ...live, archiveEnabled: false } },
    })
    expect(html).not.toContain('href=')
    expect(html).not.toContain('s-nl-all')
  })

  it('should render nothing for a missing newsletter, samples in the editor', () => {
    expect(renderSite(siteDoc([issues({ newsletterId: '' })]))).not.toContain(
      's-nl-issues',
    )
    const editing = renderSiteEditing(siteDoc([issues({ newsletterId: '' })]))
    expect(editing).toContain('Novidades de outubro')
    expect(editing).toContain('Ver todas as edições')
    expect(
      renderSiteEditing(siteDoc([issues({ newsletterId: 'gone' })])),
    ).toContain('não está mais ativa')
  })
})

describe('newsletter elements in the catalog', () => {
  it('should validate documents with both elements', () => {
    const result = validateDocument(
      siteDoc([subscribe(), issues()]),
      siteCatalog,
    )
    expect(result.ok).toBe(true)
  })

  it('should compile their structural and node CSS', () => {
    const css = compileSiteCss(
      siteDoc([
        subscribe({ layout: 'inline', fieldBackground: '#ffffff' }),
        issues({
          columns: { base: '3', mobile: '1' },
          accentColor: '#ff0000',
          cardBackground: '#eeeeee',
        }),
        issues({ layout: 'list' }),
      ]),
    )
    expect(css).toContain('.s-nl-items{')
    expect(css).toContain('flex-direction:row')
    expect(css).toContain('repeat(3, minmax(0, 1fr))')
    expect(css).toContain('#ff0000')
    expect(css).toContain('#eeeeee')
    expect(compileSiteCss(siteDoc([subscribe()]))).toContain(
      'flex-direction:column',
    )
  })

  it('should ship the newsletter script only with a picked subscribe form', () => {
    expect(siteRuntimeFeatures([siteDoc([subscribe()])])).toEqual([
      'newsletter',
    ])
    expect(
      siteRuntimeFeatures([siteDoc([subscribe({ newsletterId: '' })])]),
    ).toEqual([])
    expect(siteRuntimeFeatures([siteDoc([issues()])])).toEqual([])
    expect(siteRuntimeScripts([siteDoc([subscribe()])]).boot).toBeNull()
  })

  it('should collect the newsletter ids of a page', () => {
    expect(
      collectNewsletterIds([
        siteDoc([subscribe(), issues({ newsletterId: 'nl2' })]),
        siteDoc([issues(), subscribe({ newsletterId: '' })]),
      ]).sort(),
    ).toEqual(['nl1', 'nl2'])
  })
})
