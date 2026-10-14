/**
 * Media of a published wiki page (`/w/<token>`). The editor stores each
 * upload as a pre-signed MinIO URL (`…/wiki-media/<workspaceId>/<file>?X-Amz-…`)
 * that expires in an hour and may point at a host anonymous visitors cannot
 * reach. The public page rewrites those URLs to its own media proxy
 * (`/api/wiki/public/<token>/media?key=…`), which streams the object only
 * while the page stays published and only for keys the page references.
 */

const BUCKET_SEGMENT = '/wiki-media/'

/**
 * The object key of a wiki media URL of this workspace, or null for any
 * other URL (external images, other workspaces, malformed keys).
 */
export function wikiMediaKeyFromUrl(
  url: string,
  workspaceId: string,
): string | null {
  let pathname: string
  try {
    pathname = new URL(url, 'http://local').pathname
  } catch {
    return null
  }
  const index = pathname.indexOf(BUCKET_SEGMENT)
  if (index < 0) return null
  let key: string
  try {
    key = decodeURIComponent(pathname.slice(index + BUCKET_SEGMENT.length))
  } catch {
    return null
  }
  if (!key.startsWith(`${workspaceId}/`)) return null
  if (key.split('/').some((part) => part === '' || part === '..')) return null
  return key
}

export function wikiPublicMediaPath(token: string, key: string): string {
  return `/api/wiki/public/${token}/media?key=${encodeURIComponent(key)}`
}

function rewriteNode(
  node: unknown,
  rewriteUrl: (url: string) => string,
): unknown {
  if (Array.isArray(node)) {
    return node.map((child) => rewriteNode(child, rewriteUrl))
  }
  if (node === null || typeof node !== 'object') return node
  const out: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(node)) {
    out[field] =
      field === 'url' && typeof value === 'string'
        ? rewriteUrl(value)
        : rewriteNode(value, rewriteUrl)
  }
  return out
}

/**
 * Rewrites every wiki media `url` of the content (images, video, audio,
 * files, at any depth) to the public proxy. Other URLs stay as they are.
 */
export function rewriteWikiMediaUrls<T>(
  content: T,
  workspaceId: string,
  token: string,
): T {
  return rewriteNode(content, (url) => {
    const key = wikiMediaKeyFromUrl(url, workspaceId)
    return key ? wikiPublicMediaPath(token, key) : url
  }) as T
}

/** Rewrites a single URL (the cover image), keeping non-media URLs. */
export function rewriteWikiMediaUrl(
  url: string | null,
  workspaceId: string,
  token: string,
): string | null {
  if (!url) return url
  const key = wikiMediaKeyFromUrl(url, workspaceId)
  return key ? wikiPublicMediaPath(token, key) : url
}

/** Every wiki media key the page references (content and cover). */
export function collectWikiMediaKeys(
  content: unknown,
  coverImage: string | null,
  workspaceId: string,
): Set<string> {
  const keys = new Set<string>()
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    if (node === null || typeof node !== 'object') return
    for (const [field, value] of Object.entries(node)) {
      if (field === 'url' && typeof value === 'string') {
        const key = wikiMediaKeyFromUrl(value, workspaceId)
        if (key) keys.add(key)
      } else {
        visit(value)
      }
    }
  }
  visit(content)
  if (coverImage) {
    const key = wikiMediaKeyFromUrl(coverImage, workspaceId)
    if (key) keys.add(key)
  }
  return keys
}
