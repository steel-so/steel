/**
 * HTML of the API reference page (`/dev/api`), rendered by Scalar in the
 * browser. The bundle comes from jsDelivr pinned to an exact version with
 * Subresource Integrity, and both script tags carry the request's CSP nonce:
 * the site's `script-src` only allows `'self'` and that nonce.
 */
export const SCALAR_VERSION = '1.70.0'
export const SCALAR_SRC = `https://cdn.jsdelivr.net/npm/@scalar/api-reference@${SCALAR_VERSION}/dist/browser/standalone.js`
export const SCALAR_INTEGRITY =
  'sha384-C7UjpUKXe2xpcKhU1f0d6mVriqbtN0f9QsgEdE8Q5cSQdY0Z+u/mCdhfxX6v/Cl/'

export const API_REFERENCE_TITLE = 'Referência da API | Steel'
export const API_REFERENCE_DESCRIPTION =
  'Referência da API REST do Steel: autenticação, workspaces, ServiceDesk, CRM, Comunicação e Steel AI.'

interface ApiReferenceHtmlOptions {
  nonce: string
  specUrl: string
  canonicalUrl: string
  /** Defaults to the app's reference (`/dev/api`). */
  title?: string
  description?: string
}

const escapeAttr = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

export function buildApiReferenceHtml({
  nonce,
  specUrl,
  canonicalUrl,
  title = API_REFERENCE_TITLE,
  description = API_REFERENCE_DESCRIPTION,
}: ApiReferenceHtmlOptions): string {
  const attrNonce = escapeAttr(nonce)
  // JSON.stringify + `<` escaping keeps the config inert inside <script>.
  const config = JSON.stringify({
    url: specUrl,
    theme: 'saturn',
    withDefaultFonts: false,
    hideClientButton: true,
    metaData: { title },
  }).replace(/</g, '\\u003c')

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeAttr(title)}</title>
    <meta name="description" content="${escapeAttr(description)}" />
    <link rel="canonical" href="${escapeAttr(canonicalUrl)}" />
  </head>
  <body>
    <div id="api-reference"></div>
    <script src="${SCALAR_SRC}" integrity="${SCALAR_INTEGRITY}" crossorigin="anonymous" nonce="${attrNonce}"></script>
    <script nonce="${attrNonce}">Scalar.createApiReference('#api-reference', ${config})</script>
  </body>
</html>
`
}

export const API_V1_REFERENCE_TITLE = 'API pública v1 | Steel'
export const API_V1_REFERENCE_DESCRIPTION =
  'Referência da API pública v1 do Steel: contrato estável com token pessoal, para integrações, scripts e o Steel CLI.'
