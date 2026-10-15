/**
 * schema.org nodes of a blog post (`BlogPosting` and, with a FAQ, a
 * `FAQPage`), appended to the page graph of `siteJsonLd` (they reference
 * its Organization, WebSite and WebPage by `@id`). Pure.
 */

type JsonLdNode = Record<string, unknown>

export interface PostJsonLdInput {
  /** Canonical URL of the post. */
  url: string
  /** Site home URL with the trailing slash (graph ids). */
  siteUrl: string
  headline: string
  description?: string
  imageUrl?: string
  publishedAt: string
  updatedAt: string
  wordCount: number
  author?: { name: string; url: string } | null
  keywords: string[]
  section?: string
  focusKeyword?: string
  faq: Array<{ question: string; answer: string }>
}

export function postJsonLd(input: PostJsonLdInput): JsonLdNode[] {
  const organizationId = `${input.siteUrl}#organization`
  const keywords = [
    ...new Set(
      [input.focusKeyword, ...input.keywords].filter((value): value is string =>
        Boolean(value?.trim()),
      ),
    ),
  ]
  const posting: JsonLdNode = {
    '@type': 'BlogPosting',
    '@id': `${input.url}#article`,
    mainEntityOfPage: { '@id': `${input.url}#webpage` },
    isPartOf: { '@id': `${input.siteUrl}#website` },
    headline: input.headline.slice(0, 110),
    ...(input.description ? { description: input.description } : {}),
    ...(input.imageUrl ? { image: [input.imageUrl] } : {}),
    datePublished: input.publishedAt,
    dateModified: input.updatedAt,
    inLanguage: 'pt-BR',
    wordCount: input.wordCount,
    author: input.author
      ? { '@type': 'Person', name: input.author.name, url: input.author.url }
      : { '@id': organizationId },
    publisher: { '@id': organizationId },
    ...(keywords.length ? { keywords: keywords.join(', ') } : {}),
    ...(input.section ? { articleSection: input.section } : {}),
  }
  if (input.faq.length === 0) return [posting]
  return [
    posting,
    {
      '@type': 'FAQPage',
      '@id': `${input.url}#post-faq`,
      url: input.url,
      inLanguage: 'pt-BR',
      isPartOf: { '@id': `${input.siteUrl}#website` },
      mainEntity: input.faq.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: { '@type': 'Answer', text: item.answer },
      })),
    },
  ]
}

/** `graph` with extra nodes appended to its `@graph`. */
export function withGraphNodes(
  graph: JsonLdNode,
  nodes: JsonLdNode[],
): JsonLdNode {
  const current = Array.isArray(graph['@graph'])
    ? (graph['@graph'] as JsonLdNode[])
    : []
  return { ...graph, '@graph': [...current, ...nodes] }
}
