/**
 * The public copy of the API reference (`/dev/api`). The generated spec
 * (`public/openapi.json`) documents every route, including the global admin
 * panel and the internal status collectors, which are operated by Stratus
 * and are of no use to a customer integrating with Steel. Those are dropped,
 * and the servers list (local + homologação) is replaced by this site.
 */

interface OpenApiDocument {
  servers?: { url: string; description?: string }[]
  tags?: { name: string }[]
  'x-tagGroups'?: { name: string; tags: string[] }[]
  paths?: Record<string, Record<string, { tags?: string[] }>>
  [key: string]: unknown
}

/** Path prefixes (relative to `/api`) that stay out of the public copy. */
export const INTERNAL_PATH_PREFIXES = ['/admin', '/status/collect'] as const

const isInternal = (route: string) =>
  INTERNAL_PATH_PREFIXES.some(
    (prefix) => route === prefix || route.startsWith(`${prefix}/`),
  )

export function toPublicOpenApi(
  spec: OpenApiDocument,
  siteUrl: string,
  /** Base path of the document's paths (`/api/v1` for the public API v1). */
  basePath = '/api',
): OpenApiDocument {
  const paths = Object.fromEntries(
    Object.entries(spec.paths ?? {}).filter(([route]) => !isInternal(route)),
  )

  const usedTags = new Set<string>()
  for (const operations of Object.values(paths)) {
    for (const operation of Object.values(operations)) {
      for (const tag of operation.tags ?? []) usedTags.add(tag)
    }
  }

  const tags = (spec.tags ?? []).filter((tag) => usedTags.has(tag.name))
  const tagGroups = (spec['x-tagGroups'] ?? [])
    .map((group) => ({
      ...group,
      tags: group.tags.filter((tag) => usedTags.has(tag)),
    }))
    .filter((group) => group.tags.length > 0)

  return {
    ...spec,
    servers: [{ url: `${siteUrl}${basePath}`, description: 'Steel' }],
    tags,
    'x-tagGroups': tagGroups,
    paths,
  }
}
