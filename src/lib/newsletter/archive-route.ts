/**
 * Pages of the public newsletter archive the proxy checks before rendering
 * (ADR 0054): `/n/<ws>/<newsletter>` and `/n/<ws>/<newsletter>/<issue>`.
 * The RSS route handler answers its own 404 and is left out.
 */
export type NewsletterArchivePage = {
  workspaceSlug: string
  newsletterSlug: string
  issueSlug?: string
}

export function newsletterArchivePage(
  pathname: string,
): NewsletterArchivePage | null {
  const parts = pathname.replace(/\/+$/, '').split('/')
  // ['', 'n', ws, newsletter, issue?]
  if (parts[0] !== '' || parts[1] !== 'n') return null
  if (parts.length !== 4 && parts.length !== 5) return null
  const [workspaceSlug, newsletterSlug, issueSlug] = parts
    .slice(2)
    .map((part) => {
      try {
        return decodeURIComponent(part)
      } catch {
        return ''
      }
    })
  if (!workspaceSlug || !newsletterSlug) return null
  if (parts.length === 4) return { workspaceSlug, newsletterSlug }
  if (!issueSlug || issueSlug === 'rss.xml') return null
  return { workspaceSlug, newsletterSlug, issueSlug }
}

/** Small self-contained pt-BR 404 page of the archive (light and dark). */
export function newsletterNotFoundHtml(): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><meta name="color-scheme" content="light dark"><title>Newsletter não encontrada</title><style>html,body{margin:0}body{min-height:100svh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:48px 16px;box-sizing:border-box;text-align:center;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#fff;color:#161c2d;border-top:6px solid #161c2d}h1{margin:0;font-size:1.5rem}p{margin:0;max-width:28rem;color:#5c6272;line-height:1.5}footer{margin-top:32px;font-size:.75rem;color:#8a8f9c}@media (prefers-color-scheme:dark){body{background:#0b0d12;color:#eef0f4;border-top-color:#eef0f4}p{color:#a3a8b5}}</style></head><body><main><h1>Newsletter não encontrada</h1><p>O endereço pode estar incorreto, a edição pode ter sido removida ou o arquivo desta newsletter não está mais público.</p></main><footer>Publicado com Steel</footer></body></html>`
}
