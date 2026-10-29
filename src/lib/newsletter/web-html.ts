/**
 * Prepares the stored web HTML of an issue (`CrmNewsletterIssue.webHtml`,
 * written by the send step without personal data) for the `srcdoc` of the
 * sandboxed iframe on `/n/<ws>/<newsletter>/<issue>`.
 *
 * Why an iframe and not inlined HTML: the issue is a full e-mail document
 * (`<html>`, `<head><style>`, table layout) whose styles would leak into the
 * archive page, and it is customer-authored markup. The frame is sandboxed
 * without `allow-scripts` (nothing inside runs, on top of the CSP the
 * `srcdoc` document inherits from the page), without `allow-forms`, and
 * with `allow-same-origin` only so the page can read the content height.
 * Links open in a new tab (`<base target="_blank">` + `allow-popups`).
 */
const HEAD_EXTRAS =
  '<base target="_blank"><meta name="referrer" content="strict-origin-when-cross-origin">'

export function issueFrameDocument(webHtml: string): string {
  const head = /<head(\s[^>]*)?>/i.exec(webHtml)
  if (head) {
    const at = head.index + head[0].length
    return `${webHtml.slice(0, at)}${HEAD_EXTRAS}${webHtml.slice(at)}`
  }
  return `<!doctype html><html><head><meta charset="utf-8">${HEAD_EXTRAS}</head><body>${webHtml}</body></html>`
}
