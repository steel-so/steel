import { parseSearchContent } from '@/src/schemas/site-search.schema'
import { sitePageUrl } from '../host'
import {
  indexablePages,
  publicPathOf,
  type SiteSnapshot,
  type SiteSnapshotPage,
} from '../snapshot'
import { formatAddress, formatHours } from './business'
import { extractPageContent } from './content'
import { resolveBusinessProfile, searchSettingsOf } from './context'

/**
 * `/llms.txt` and `/llms-full.txt` of a published site (llmstxt.org): a
 * Markdown summary for AI assistants — what the business is, its key
 * facts, the page index and the questions it answers — and the full text
 * of every indexable page. Pure; the runtime serves them from the snapshot.
 */

/** Upper bound of `/llms-full.txt` (characters). */
export const LLMS_FULL_MAX_CHARS = 400_000

/** Pages listed: indexable and canonical to themselves. */
export function llmsPages(
  snapshot: SiteSnapshot,
  baseUrl: string,
): Array<{ page: SiteSnapshotPage; url: string }> {
  return indexablePages(snapshot)
    .map((page) => ({
      page,
      url: sitePageUrl(baseUrl, publicPathOf(snapshot, page)),
    }))
    .filter(
      ({ page, url }) =>
        !page.seo.canonicalUrl || page.seo.canonicalUrl === url,
    )
}

/** Whether the site publishes llms.txt (on, and not hidden from search). */
export function llmsEnabled(snapshot: SiteSnapshot): boolean {
  return (
    !snapshot.settings.seo.noindex &&
    searchSettingsOf(snapshot.settings).llms.enabled
  )
}

/** One line of Markdown (no line breaks, no stray brackets). */
function inline(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/[[\]]/g, '').trim()
}

function factsOf(snapshot: SiteSnapshot): string[] {
  const profile = resolveBusinessProfile(snapshot.settings, snapshot.name)
  const facts: Array<[string, string | undefined]> = [
    ['Nome', profile.name],
    ['Razão social', profile.legalName],
    ['Categoria', profile.category],
    ['Endereço', formatAddress(profile)],
    ['Telefone', profile.phone],
    ['E-mail', profile.email],
    ['Horário', formatHours(profile)],
    ['Área atendida', profile.serviceArea?.join(', ')],
    [
      'Fundação',
      profile.foundingYear ? String(profile.foundingYear) : undefined,
    ],
    ['Faixa de preço', profile.priceRange],
    [
      'Pessoas',
      profile.people
        ?.map((person) =>
          person.role ? `${person.name} (${person.role})` : person.name,
        )
        .join(', '),
    ],
    ['Perfis oficiais', profile.sameAs?.join(', ')],
  ]
  return facts
    .filter((fact): fact is [string, string] => Boolean(fact[1]))
    .map(([label, value]) => `- ${label}: ${inline(value)}`)
}

function header(snapshot: SiteSnapshot): string[] {
  const profile = resolveBusinessProfile(snapshot.settings, snapshot.name)
  const settings = searchSettingsOf(snapshot.settings)
  const lines = [`# ${inline(profile.name ?? snapshot.name)}`, '']
  if (profile.description) lines.push(`> ${inline(profile.description)}`, '')
  if (settings.llms.notes) lines.push(settings.llms.notes.trim(), '')
  const facts = factsOf(snapshot)
  if (facts.length) lines.push('## Fatos', '', ...facts, '')
  return lines
}

function pageSummary(page: SiteSnapshotPage): string {
  const search = parseSearchContent(page.seo.search)
  return inline(search.summary || page.seo.description || '')
}

/** Questions and answers of the site (accordions first, then the
 * questions registered per page), without repeats. */
function faqOf(
  pages: Array<{ page: SiteSnapshotPage }>,
): Array<{ question: string; answer: string }> {
  const seen = new Set<string>()
  const out: Array<{ question: string; answer: string }> = []
  for (const { page } of pages) {
    const registered = (
      parseSearchContent(page.seo.search).questions ?? []
    ).filter((item) => item.answer)
    for (const item of [
      ...extractPageContent(page.document).faq,
      ...registered,
    ]) {
      const key = item.question.toLowerCase().trim()
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ question: item.question, answer: item.answer })
    }
  }
  return out
}

export function renderLlmsTxt(snapshot: SiteSnapshot, baseUrl: string): string {
  const pages = llmsPages(snapshot, baseUrl)
  const lines = header(snapshot)
  if (pages.length) {
    lines.push('## Páginas', '')
    for (const { page, url } of pages) {
      const summary = pageSummary(page)
      lines.push(
        `- [${inline(page.seo.title || page.title)}](${url})${summary ? `: ${summary}` : ''}`,
      )
    }
    lines.push('')
  }
  const faq = faqOf(pages).slice(0, 30)
  if (faq.length) {
    lines.push('## Perguntas frequentes', '')
    for (const item of faq) {
      lines.push(`- ${inline(item.question)} ${inline(item.answer)}`)
    }
    lines.push('')
  }
  lines.push(
    '## Opcional',
    '',
    `- [Conteúdo completo](${baseUrl}/llms-full.txt): texto de todas as páginas`,
    `- [Sitemap](${baseUrl}/sitemap.xml)`,
    '',
  )
  return lines.join('\n')
}

/** Page text as Markdown: headings keep their level, blocks are
 * paragraphs and accordion items are bold questions. */
function pageMarkdown(page: SiteSnapshotPage): string {
  const content = extractPageContent(page.document)
  const out: string[] = []
  for (const item of content.flow) {
    if (item.type === 'heading') {
      out.push(
        item.level === 0
          ? `**${inline(item.text)}**`
          : `${'#'.repeat(Math.min(6, item.level + 2))} ${inline(item.text)}`,
      )
    } else {
      out.push(item.text.trim())
    }
  }
  return out.join('\n\n')
}

export function renderLlmsFullTxt(
  snapshot: SiteSnapshot,
  baseUrl: string,
  maxChars = LLMS_FULL_MAX_CHARS,
): string {
  let text = header(snapshot).join('\n')
  for (const { page, url } of llmsPages(snapshot, baseUrl)) {
    const summary = pageSummary(page)
    const section = [
      `## ${inline(page.seo.title || page.title)}`,
      '',
      `URL: ${url}`,
      ...(page.updatedAt
        ? [`Atualizado em: ${page.updatedAt.slice(0, 10)}`]
        : []),
      '',
      ...(summary ? [`> ${summary}`, ''] : []),
      pageMarkdown(page),
      '',
      '',
    ].join('\n')
    if (text.length + section.length > maxChars) {
      text +=
        '\n[Conteúdo truncado: o site é maior que o limite deste arquivo.]\n'
      break
    }
    text += `\n${section}`
  }
  return text
}
