import { describe, expect, it } from 'vitest'
import {
  seedArchiveIssue,
  seedArchiveNewsletter,
} from '@/src/__tests__/factories/newsletter-archive.factory'
import { authenticatedOwner, getJson } from '@/src/__tests__/helpers/e2e'
import { prisma } from '@/src/lib/prisma'

/**
 * The root layout streams every page inside a Suspense boundary, so a
 * `notFound()` in the page body arrives as the not-found UI (and its
 * `NEXT_HTTP_ERROR_FALLBACK;404` digest) after the 200 status is sent.
 */
async function expectNotFound(res: Response, hidden: string) {
  const html = await res.text()
  expect([200, 404]).toContain(res.status)
  expect(html).toContain('NEXT_HTTP_ERROR_FALLBACK;404')
  expect(html).not.toContain(hidden)
}

async function publishedNewsletter() {
  const { user, workspace } = await authenticatedOwner()
  const newsletter = await seedArchiveNewsletter(workspace.id, user.id, {
    name: 'Novidades E2E',
    description: 'Tudo sobre a Acme.',
    cadenceLabel: 'Mensal',
  })
  const first = await seedArchiveIssue(newsletter, {
    number: 1,
    subject: 'Primeira edição',
    sentAt: new Date('2026-09-01T12:00:00Z'),
    webHtml:
      '<html><head><style>p{color:red}</style></head><body><p>Conteúdo da primeira</p></body></html>',
  })
  const second = await seedArchiveIssue(newsletter, {
    number: 2,
    subject: 'Segunda edição',
    excerpt: 'Resumo da segunda',
    sentAt: new Date('2026-10-01T12:00:00Z'),
  })
  await seedArchiveIssue(newsletter, {
    status: 'DRAFT',
    number: null,
    sentAt: null,
    subject: 'Rascunho secreto',
  })
  const base = `/n/${workspace.slug}/${newsletter.slug}`
  return { workspace, newsletter, first, second, base }
}

describe('GET /n/[workspaceSlug]/[newsletterSlug]', () => {
  it('renders the archive anonymously with the sent issues only', async () => {
    const { base, second } = await publishedNewsletter()

    const res = await getJson(base)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Novidades E2E')
    expect(html).toContain('Tudo sobre a Acme.')
    expect(html).toContain('Mensal')
    expect(html).toContain('Segunda edição')
    expect(html).toContain('Resumo da segunda')
    expect(html).toContain(`${base}/${second.slug}`)
    expect(html).not.toContain('Rascunho secreto')
    expect(html).toContain('application/rss+xml')
    expect(html).toContain('rel="canonical"')
    expect(html).toContain('og:title')
  })

  it('404s an archived newsletter, an archive switched off and the CRM off', async () => {
    const { base, newsletter, workspace } = await publishedNewsletter()

    await prisma.crmNewsletter.update({
      where: { id: newsletter.id },
      data: { archiveEnabled: false },
    })
    await expectNotFound(await getJson(`${base}?pagina=2`), 'Segunda edição')

    await prisma.crmNewsletter.update({
      where: { id: newsletter.id },
      data: { archiveEnabled: true, status: 'ARCHIVED' },
    })
    await expectNotFound(await getJson(`${base}?pagina=3`), 'Segunda edição')

    await prisma.crmNewsletter.update({
      where: { id: newsletter.id },
      data: { status: 'ACTIVE' },
    })
    await prisma.workspaceModuleAccess.updateMany({
      where: { workspaceId: workspace.id, module: 'CRM' },
      data: { enabled: false },
    })
    await expectNotFound(await getJson(`${base}?pagina=4`), 'Segunda edição')
  })
})

describe('GET /n/[workspaceSlug]/[newsletterSlug]/[issueSlug]', () => {
  it('renders the web version in a sandboxed frame with neighbours', async () => {
    const { base, first, second } = await publishedNewsletter()

    const res = await getJson(`${base}/${first.slug}`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Primeira edição')
    expect(html).toContain('sandbox="allow-same-origin allow-popups')
    expect(html).not.toContain('allow-scripts')
    expect(html).toContain('Conteúdo da primeira')
    expect(html).toContain(`${base}/${second.slug}`)
    expect(html).toContain('Gostou? Assine Novidades E2E')
  })

  it('404s a draft issue', async () => {
    const { base, newsletter } = await publishedNewsletter()
    const draft = await seedArchiveIssue(newsletter, {
      status: 'SCHEDULED',
      number: null,
      sentAt: null,
      subject: 'Agendada oculta',
    })
    await expectNotFound(
      await getJson(`${base}/${draft.slug}`),
      'Agendada oculta',
    )
  })
})

describe('GET /n/[workspaceSlug]/[newsletterSlug]/rss.xml', () => {
  it('serves RSS 2.0 with absolute links', async () => {
    const { base, second } = await publishedNewsletter()

    const res = await getJson(`${base}/rss.xml`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/rss+xml')
    const xml = await res.text()
    expect(xml).toContain('<rss version="2.0"')
    expect(xml).toMatch(
      new RegExp(`<link>https?://[^<]+${base}/${second.slug}</link>`),
    )
    expect(xml).not.toContain('Rascunho secreto')
  })

  it('404s an unknown newsletter', async () => {
    const res = await getJson('/n/nao-existe/nada/rss.xml')
    expect(res.status).toBe(404)
  })
})
