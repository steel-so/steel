import {
  normalizeRichText,
  sanitizeRichText,
} from '@/src/lib/crm-email-builder/rich-text'

export { sanitizeRichText }

/**
 * Rich text of an `email.text` block as e-mail HTML. Only the inline subset
 * of the v1 builder survives (paragraphs, breaks, bold/italic/underline/
 * strike, links, lists) — sanitized again here, so stored HTML is never
 * trusted. Font size, color and alignment are left to the wrapper so the
 * mobile media query can override them.
 */
export function emailRichTextHtml(html: string, linkColor: string): string {
  return escapeStrayBrackets(normalizeRichText(html))
    .replace(/<p>/g, '<p style="margin:0 0 16px">')
    .replace(/<(ul|ol)>/g, '<$1 style="margin:0 0 16px;padding-left:24px">')
    .replace(/<li>/g, '<li style="margin:0 0 4px">')
    .replace(
      /<a( href="[^"]*")?>/g,
      `<a$1 style="color:${linkColor};text-decoration:underline">`,
    )
}

/** The rich-text sanitizer only rewrites complete tags; a half-written one
 * (`<img src=x onerror=…` with no `>`) would survive as raw markup. Its
 * output tags are canonical, so anything else with `<`/`>` is text. */
const CANONICAL =
  /<\/?(?:p|br|strong|b|em|i|u|s|ul|ol|li)>|<a(?: href="[^"<>]*")?>|<\/a>|[<>]/g

export function escapeStrayBrackets(html: string): string {
  return html.replace(CANONICAL, (match) =>
    match === '<' ? '&lt;' : match === '>' ? '&gt;' : match,
  )
}
