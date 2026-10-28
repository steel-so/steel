/**
 * Public URLs of the newsletter (ADR 0054). Pure: callers pass the app base
 * URL (`BETTER_AUTH_URL`). Routes:
 *
 * | Path | Owner slice | What |
 * |---|---|---|
 * | `/n/<ws>/<newsletter>` | archive | archive + subscribe form |
 * | `/n/<ws>/<newsletter>/<issue>` | archive | web version of an issue |
 * | `/n/<ws>/<newsletter>/rss.xml` | archive | RSS 2.0 feed |
 * | `/newsletter/confirmar/<token>` | core | double opt-in confirmation |
 * | `/newsletter/preferencias/<token>` | core | preference center |
 * | `/newsletter/sair/<token>` | core | unsubscribe page (footer link) |
 * | `POST /api/newsletters/unsubscribe/<token>` | core | RFC 8058 one-click |
 * | `POST /api/newsletters/subscribe` | core | public subscribe |
 */

const trim = (baseUrl: string) => baseUrl.replace(/\/$/, '')

export function newsletterArchiveUrl(
  baseUrl: string,
  workspaceSlug: string,
  newsletterSlug: string,
): string {
  return `${trim(baseUrl)}/n/${workspaceSlug}/${newsletterSlug}`
}

export function newsletterIssueUrl(
  baseUrl: string,
  workspaceSlug: string,
  newsletterSlug: string,
  issueSlug: string,
): string {
  return `${newsletterArchiveUrl(baseUrl, workspaceSlug, newsletterSlug)}/${issueSlug}`
}

export function newsletterRssUrl(
  baseUrl: string,
  workspaceSlug: string,
  newsletterSlug: string,
): string {
  return `${newsletterArchiveUrl(baseUrl, workspaceSlug, newsletterSlug)}/rss.xml`
}

export function newsletterConfirmUrl(baseUrl: string, token: string): string {
  return `${trim(baseUrl)}/newsletter/confirmar/${token}`
}

export function newsletterPreferencesUrl(
  baseUrl: string,
  token: string,
): string {
  return `${trim(baseUrl)}/newsletter/preferencias/${token}`
}

export type NewsletterUnsubscribeUrls = {
  /** Footer link: public page with the confirmation. */
  pageUrl: string
  /** RFC 8058 one-click POST target. */
  oneClickUrl: string
}

export function newsletterUnsubscribeUrls(
  baseUrl: string,
  token: string,
): NewsletterUnsubscribeUrls {
  const base = trim(baseUrl)
  return {
    pageUrl: `${base}/newsletter/sair/${token}`,
    oneClickUrl: `${base}/api/newsletters/unsubscribe/${token}`,
  }
}

/** RFC 2369 + RFC 8058 headers (Gmail/Yahoo bulk sender rules). */
export function newsletterUnsubscribeHeaders(
  urls: NewsletterUnsubscribeUrls,
): Record<string, string> {
  return {
    'List-Unsubscribe': `<${urls.oneClickUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}

/** Lower-case FQDN of an e-mail address ("Ana@News.Acme.com" → "news.acme.com"). */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@')
  return at === -1
    ? ''
    : email
        .slice(at + 1)
        .trim()
        .toLowerCase()
}
