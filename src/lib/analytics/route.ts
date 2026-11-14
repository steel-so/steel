/**
 * Normaliza um pathname para agrupar requisições da mesma rota no painel
 * Analytics: ids (cuid2, uuid, números, hashes, tokens) viram `[id]`, o slug
 * do workspace nas páginas privadas vira `[workspace]` e o segmento dos links
 * públicos (formulário, proposta, descadastro) vira `[token]`.
 * Roda no momento do log — a rota normalizada vai para `request.route`.
 */

/** Primeiros segmentos que são páginas/rotas fixas (não slug de workspace). */
const STATIC_ROOTS = new Set([
  'api',
  'admin',
  'create-workspace',
  'reference',
  'docs',
  'f',
  'p',
  'l',
  'forget-password',
  'invite',
  'legals',
  'reset-password',
  'sign-in',
  'sign-up',
  'status',
  'unsubscribe',
  'marketplace',
  'pricing',
  'talk-to-sales',
  'jobs',
  'onboarding',
  'upgrade',
  'openapi.json',
  'contact',
  'testes',
  'favicon.ico',
  'robots.txt',
  'sitemap.xml',
  'manifest.webmanifest',
  '_next',
  'media',
])

/** Links públicos cujo segundo segmento é um token/slug de compartilhamento. */
const PUBLIC_TOKEN_ROOTS = new Set(['f', 'p', 'l', 'unsubscribe'])

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NUMERIC = /^\d+$/
const HEX = /^[0-9a-f]{16,}$/i
/** cuid2 (24 por padrão) / cuid v1 (25): minúsculas + dígitos. */
const CUID = /^[a-z][a-z0-9]{19,31}$/
const LONG_TOKEN = /^[\w-]{32,}$/
const HAS_DIGIT = /\d/

export function isIdSegment(segment: string): boolean {
  if (segment.includes('@')) return true
  if (NUMERIC.test(segment) || UUID.test(segment) || HEX.test(segment)) {
    return true
  }
  if (CUID.test(segment) && HAS_DIGIT.test(segment)) return true
  if (LONG_TOKEN.test(segment)) return true
  // Mistura de letras e 4+ dígitos (telefone com prefixo, protocolo...).
  return /\d{4,}/.test(segment) && segment.length >= 8
}

export function normalizeRoute(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] || '/'
  const segments = path.split('/').filter(Boolean)
  if (segments.length === 0) return '/'

  const out = segments.map((segment, index) => {
    let decoded = segment
    try {
      decoded = decodeURIComponent(segment)
    } catch {
      // segmento mal codificado: segue cru
    }
    if (index === 0) {
      if (STATIC_ROOTS.has(decoded)) return decoded
      return isIdSegment(decoded) ? '[id]' : '[workspace]'
    }
    if (index === 1 && PUBLIC_TOKEN_ROOTS.has(segments[0])) return '[token]'
    return isIdSegment(decoded) ? '[id]' : decoded
  })
  return `/${out.join('/')}`
}

/**
 * Slug do workspace de uma página privada (`/acme/crm/leads` → `acme`), ou
 * `null` em rotas fixas/API. Serve para filtrar page views por workspace.
 */
export function workspaceSlugFromPath(pathname: string): string | null {
  const first = pathname.split(/[?#]/)[0].split('/').filter(Boolean)[0]
  if (!first || STATIC_ROOTS.has(first) || isIdSegment(first)) return null
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(first) ? first : null
}

/** `/api/workspaces/:id/...` → id (o mesmo recorte do uso por módulo). */
export function workspaceIdFromApiPath(pathname: string): string | null {
  const match = /^\/api\/workspaces\/([^/]+)(?:\/|$)/.exec(pathname)
  return match && isIdSegment(match[1]) ? match[1] : null
}
