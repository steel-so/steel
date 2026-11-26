/**
 * Splits plain text into text and link parts so a message can render its
 * URLs as anchors. Only `http(s)://` and `www.` addresses are links (never
 * `javascript:` and friends), and trailing punctuation stays outside.
 */
export type LinkifyPart =
  | { type: 'text'; text: string }
  | { type: 'link'; text: string; href: string }

const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"']+/gi
const TRAILING_PUNCTUATION = '.,;:!?]}»”’'

const count = (text: string, char: string) => text.split(char).length - 1

/** Drops the punctuation that closes a sentence, not the address. */
function trimUrl(raw: string): string {
  let url = raw
  for (;;) {
    const last = url.at(-1)
    if (!last) return url
    const stray =
      TRAILING_PUNCTUATION.includes(last) ||
      // "(veja https://x.com/a)" — the ")" only belongs to a URL that opened it.
      (last === ')' && count(url, ')') > count(url, '('))
    if (!stray) return url
    url = url.slice(0, -1)
  }
}

/** Needs a dot in the host, so "http://" or "www." alone stay plain text. */
function hasHost(url: string): boolean {
  const host = url.replace(/^(?:https?:\/\/|www\.)/i, '').split(/[/?#]/)[0]
  return Boolean(host && /[^.]\.[^.]/.test(host))
}

export function linkifyText(input: string): LinkifyPart[] {
  const parts: LinkifyPart[] = []
  let cursor = 0
  for (const match of input.matchAll(URL_PATTERN)) {
    const url = trimUrl(match[0])
    if (!hasHost(url)) continue
    const start = match.index ?? 0
    if (start > cursor) {
      parts.push({ type: 'text', text: input.slice(cursor, start) })
    }
    parts.push({
      type: 'link',
      text: url,
      href: /^https?:\/\//i.test(url) ? url : `https://${url}`,
    })
    cursor = start + url.length
  }
  if (cursor < input.length) {
    parts.push({ type: 'text', text: input.slice(cursor) })
  }
  return parts
}
