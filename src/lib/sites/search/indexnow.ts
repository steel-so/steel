/**
 * IndexNow (Bing, Yandex, Seznam, Naver…): on publish the site tells the
 * engines which URLs changed. The key is a random hex string the site
 * serves at `/indexnow-key.txt`, whose directory covers every URL of the
 * site. Pure.
 */

export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow'

/** Path of the key file under the site's base URL. */
export const INDEXNOW_KEY_PATH = 'indexnow-key.txt'

/** URLs per request allowed by the protocol. */
export const INDEXNOW_MAX_URLS = 10_000

/** A new 32-char hex key. */
export function generateIndexNowKey(
  random: () => Uint8Array = () => crypto.getRandomValues(new Uint8Array(16)),
): string {
  return Array.from(random(), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

export interface IndexNowPayload {
  host: string
  key: string
  keyLocation: string
  urlList: string[]
}

/** Body of the IndexNow POST; `null` without URLs. */
export function indexNowPayload(options: {
  baseUrl: string
  key: string
  urls: string[]
}): IndexNowPayload | null {
  const urls = [...new Set(options.urls)].slice(0, INDEXNOW_MAX_URLS)
  if (urls.length === 0) return null
  return {
    host: new URL(options.baseUrl).host,
    key: options.key,
    keyLocation: `${options.baseUrl}/${INDEXNOW_KEY_PATH}`,
    urlList: urls,
  }
}
