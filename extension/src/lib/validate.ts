export const TOKEN_PATTERN = /^stl_pat_[A-Za-z0-9_-]{32,128}$/

/** Turns a user-typed address into an origin, or null if it is not a Steel URL. */
export function normalizeBaseUrl(value: string): string | null {
  const text = value.trim()
  if (!text) return null
  // Another scheme (ftp://, chrome://…) is never a Steel address.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) && !/^https?:\/\//i.test(text)) return null
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return null
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null
  return url.origin
}
