/**
 * Pure pieces of a newsletter e-mail (ADR 0054): the From header, the
 * archive excerpt and the Resend tags. The mandatory footer (unsubscribe,
 * preferences and the sender's address — LGPD and the Gmail/Yahoo bulk
 * sender rules) is the canvas footer block rendered in subscription mode
 * (`crm-newsletter-render.ts`).
 */

/** `"Name" <email>`, with quotes/backslashes/line breaks of the name neutralized. */
export function newsletterFromHeader(
  fromName: string,
  fromEmail: string,
): string {
  const name = fromName
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\\"]/g, '')
    .trim()
  return name ? `"${name}" <${fromEmail}>` : fromEmail
}

/** Inserts `snippet` right before `</body>` (or at the end of a fragment). */
export function insertBeforeBodyClose(html: string, snippet: string): string {
  const at = html.search(/<\/body>/i)
  if (at === -1) return `${html}${snippet}`
  return `${html.slice(0, at)}${snippet}${html.slice(at)}`
}

/** Archive card / RSS excerpt: the first ~`max` characters of the text. */
export function issueExcerpt(text: string, max = 280): string {
  const clean = text
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\{\{[^}]*\}\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** Resend tags: ASCII letters, digits, `_` and `-` only. */
export function newsletterTags(
  issueId: string,
): { name: string; value: string }[] {
  return [
    { name: 'kind', value: 'newsletter' },
    { name: 'issue', value: issueId.replace(/[^A-Za-z0-9_-]/g, '_') },
  ]
}

/** URL-safe slug derived from a subject ("Edição #3: Novidades!" → "edicao-3-novidades"). */
export function slugifyIssueSubject(subject: string): string {
  const slug = subject
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '')
  return slug.length >= 2 ? slug : 'edicao'
}

/** Whether a Resend send error is worth retrying later. */
export function isTransientSendError(message: string): boolean {
  return /rate.?limit|429|too many|timeout|timed out|ECONN|ETIMEDOUT|fetch failed|socket|5\d\d|internal server/i.test(
    message,
  )
}

/** Resend `bounce.type`: only `Permanent` disables the address. */
export function isPermanentBounce(data: Record<string, unknown>): boolean {
  const bounce = data.bounce as { type?: unknown } | undefined
  const type = typeof bounce?.type === 'string' ? bounce.type : ''
  return type === '' || /^permanent$/i.test(type)
}

/** URL of a click event (`data.click.link`), when present. */
export function clickedLink(data: Record<string, unknown>): string | null {
  const click = data.click as { link?: unknown } | undefined
  return typeof click?.link === 'string' && click.link.length > 0
    ? click.link.slice(0, 2000)
    : null
}
