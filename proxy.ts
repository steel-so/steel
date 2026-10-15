import {
  NextResponse,
  type NextRequest,
  type NextFetchEvent,
} from 'next/server'
import { logger } from '@/lib/axiom/server'
import { logRequest } from '@/lib/axiom/request-log'
import {
  NEXT_PUBLIC_GA_ID,
  NEXT_PUBLIC_POSTHOG_KEY,
  NEXT_PUBLIC_REALTIME_URL,
  NEXT_PUBLIC_SENTRY_DSN,
  NODE_ENV,
} from '@/lib/env/env'
import { POSTHOG_PROXY_PATH } from '@/lib/posthog/constants'
import { geolocateRequest } from '@/src/lib/analytics/geoip'
import { SITES_ROOT_DOMAIN } from '@/lib/env/server'
import { siteHeaderCsp } from '@/src/lib/sites/csp'
import {
  decideSiteRoute,
  isSiteFilePath,
  siteNotFoundHtml,
} from '@/src/lib/sites/route-index'
import { SitePublicService } from '@/src/services/site-public.service'
import {
  SITE_REQUEST_HEADER,
  SITE_VIA_HOST_HEADER,
  parseSiteHost,
  resolveSiteHref,
  siteLinkBase,
  siteRewritePath,
  siteSlugFromPath,
} from '@/src/lib/sites/host'

const PUBLIC_ROUTES = [
  '/', '/sign-in', '/sign-up', '/forget-password',
  '/reset-password', '/api/auth', '/api/status',
  '/api/payment/webhook', '/docs', '/legals',
  '/status', '/pricing', '/talk-to-sales', '/dev',
  '/marketplace', '/invite', '/api/talk-to-sales',
  // Institutional pages and the crawler/answer-engine files (SEO/AEO/GEO)
  '/about', '/contact', '/manifesto', '/changelog', '/product', '/features',
  '/robots.txt', '/sitemap.xml', '/llms.txt', '/llms-full.txt',
  '/manifest.webmanifest', '/opengraph-image', '/twitter-image', '/icon',
  '/apple-icon',
  // Old address of the API reference: redirects to /dev/api
  '/reference',
  '/api/whatsapp/webhook', '/api/pabx/calls/webhook', '/api/crm/proposals', '/api/crm/forms',
  '/api/crm/integrations', '/api/crm/workflows', '/api/crm/landing-pages',
  '/f', '/p', '/l', '/api/social/blob',
  // Descadastro LGPD de campanhas de e-mail: link sem sessão (token HMAC)
  '/unsubscribe', '/api/crm/unsubscribe',
  // CRM multichannel campaigns: click redirect + open pixel (signed token)
  // and the Resend webhook (Svix signature) — no session.
  '/api/crm/campaigns/c', '/api/crm/campaigns/o',
  '/api/crm/campaigns/resend-webhook',
  // Aprovação de chamado do ServiceDesk por e-mail: link sem sessão (token)
  '/servicedesk/approval', '/api/servicedesk/approvals',
  // Abertura de chamado por monitoramento: webhook sem sessão (token na URL)
  '/api/servicedesk/monitoring',
  // Integrações do ServiceDesk: webhooks sem sessão, verificados por
  // assinatura (Slack: X-Slack-Signature; GitHub: X-Hub-Signature-256). O
  // callback OAuth (`/oauth/slack`) fica de fora de propósito: ele exige a
  // sessão do admin que autorizou.
  '/api/servicedesk/integrations/slack',
  '/api/servicedesk/integrations/github',
  // Workspace-level repository webhooks (ADR 0024), no session: GitHub is
  // verified by X-Hub-Signature-256, GitLab by X-Gitlab-Token.
  '/api/integrations/github/webhook',
  '/api/integrations/gitlab/webhook',
  // Portal do contato externo do ServiceDesk: link mágico + sessão própria
  // no cookie `sd.portal_session` (sem Better Auth; escopo no service)
  '/suporte', '/api/servicedesk/portal',
  // Published wiki pages: read-only link and its media, no session (the
  // random token in the URL is the credential; unpublishing revokes it).
  '/w', '/api/wiki/public',
  // Published sites (site builder): the runtime at /s/<slug> and its
  // page-view beacon. Sites on <slug>.<SITES_ROOT_DOMAIN> are rewritten to
  // /s/<slug> before this check.
  '/s', '/api/sites',
  // Proxy reverso do PostHog (o next.config.ts reescreve direto para o
  // PostHog). Analytics é coletado nas páginas públicas também, onde ninguém
  // tem sessão, então o gate de autenticação responderia cada beacon com um
  // redirect. Só entra na lista quando há chave configurada.
  ...(NEXT_PUBLIC_POSTHOG_KEY ? [POSTHOG_PROXY_PATH] : []),
]

/**
 * Origem de ingestão do Sentry, derivada do DSN em vez de escrita à mão: o
 * subdomínio carrega o id da organização e a região
 * (`o123.ingest.de.sentry.io`), e um deploy sem DSN não ganha host extra
 * nenhum na CSP. O `tunnelRoute` do SDK evitaria a entrada, mas transforma o
 * app num POST não autenticado que encaminha para terceiro e manda todo
 * payload de erro pelo único VPS — uma origem na CSP é a superfície menor.
 *
 * O PostHog **não** aparece aqui de propósito: ele é alcançado pelo rewrite
 * de mesma origem `/ingest`, então `'self'` já cobre.
 */
/**
 * Origens do Google Analytics, só quando há medidor configurado. O script vem
 * do `googletagmanager.com`; a coleta vai para os dois domínios, porque o
 * gtag alterna entre eles conforme a versão e a região.
 */
function googleAnalyticsSrc(): { script: string; connect: string } {
  if (!NEXT_PUBLIC_GA_ID) return { script: '', connect: '' }
  return {
    script: ' https://www.googletagmanager.com',
    connect:
      ' https://www.googletagmanager.com https://www.google-analytics.com',
  }
}

function sentryConnectSrc(): string {
  if (!NEXT_PUBLIC_SENTRY_DSN) return ''
  try {
    return ` ${new URL(NEXT_PUBLIC_SENTRY_DSN).origin}`
  } catch {
    // DSN malformado não pode derrubar a CSP inteira: sem origem extra, o
    // SDK simplesmente não consegue enviar.
    return ''
  }
}

/**
 * CSP da aplicação. **Sem `'strict-dynamic'`**: com Cache Components (PPR) a
 * casca do HTML é pré-renderizada no build, então os `<script src>` dos
 * chunks nascem sem nonce; `'strict-dynamic'` faz o navegador ignorar o
 * `'self'` e bloquear todos eles — a página renderiza, nunca hidrata e nada
 * fica clicável. Os bundles são arquivos nossos, de mesma origem, cobertos
 * por `'self'`; o nonce segue valendo para os scripts inline que o Next gera
 * nas partes dinâmicas.
 *
 * `connect-src` lista **nominalmente** cada serviço que o navegador pode
 * alcançar: Axiom (log e web vitals), jsdelivr (o Scalar em `/docs`) e o
 * Sentry quando há DSN, mais o WebSocket da Wiki (ver `realtimeConnectSrc`).
 * `va.vercel-scripts.com` saiu junto com o
 * `@vercel/analytics`: os beacons dele postavam em `/_vercel/insights/*` da
 * nossa própria origem, um caminho que só existe na Vercel e aqui respondia
 * 307 para `/sign-in`, então a entrada não protegia nada que fosse coletado.
 *
 * O PostHog não adiciona origem nenhuma: ele fala com `/ingest` de mesma
 * origem (ver `next.config.ts`), coberto por `'self'`.
 *
 * O **Google Analytics é liberado nominalmente** quando há `NEXT_PUBLIC_GA_ID`:
 * `script-src` ganha `googletagmanager.com` e `connect-src` ganha o
 * `googletagmanager.com` mais o `google-analytics.com`, que é para onde os
 * eventos são enviados. Sem isso o GA não coletava nada — o
 * `@next/third-parties/google` injeta a tag depois da hidratação, portanto
 * sem nonce, e `script-src 'self' 'nonce-…'` a recusava em silêncio (medido
 * no navegador: *"Loading the script 'https://www.googletagmanager.com/gtag/js'
 * violates the following Content Security Policy directive"*). Sem
 * `NEXT_PUBLIC_GA_ID` nenhuma dessas origens entra na política.
 */
/**
 * WebSocket da Wiki (Hocuspocus). Sem `NEXT_PUBLIC_REALTIME_URL` o editor usa
 * `/realtime` de mesma origem, coberto por `'self'`; com ela (dev, porta
 * própria) a origem entra nominalmente.
 */
function realtimeConnectSrc(): string {
  return NEXT_PUBLIC_REALTIME_URL ? ` ${new URL(NEXT_PUBLIC_REALTIME_URL).origin}` : ''
}

function buildCspHeader(nonce: string): string {
  const ga = googleAnalyticsSrc()
  return `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}'${ga.script}${NODE_ENV === 'development' ? " 'unsafe-eval'" : ''};
    style-src 'self' 'unsafe-inline';
    img-src 'self' blob: data: https:;
    media-src 'self' blob: https:;
    font-src 'self';
    connect-src 'self' blob: data: https://*.axiom.co https://cdn.jsdelivr.net${realtimeConnectSrc()}${sentryConnectSrc()}${ga.connect}${NODE_ENV === 'development' ? ' ws://localhost:4444' : ''};
    frame-src https://www.figma.com https://www.loom.com https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://docs.google.com;
    frame-ancestors 'none';
    form-action 'self';
    base-uri 'self';
    object-src 'none';
    upgrade-insecure-requests;
  `
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Published sites (`/s/<slug>`, `<slug>.<SITES_ROOT_DOMAIN>`) get their own
 * policy: none of Steel's services, plus the origins of the trackers a site
 * may load after consent. The page narrows it per site with a
 * `<meta http-equiv>` (see `src/lib/sites/csp.ts`).
 */
function cspFor(nonce: string, site: boolean): string {
  return site
    ? siteHeaderCsp({ nonce, development: NODE_ENV === 'development' })
    : buildCspHeader(nonce)
}

function withSecurityHeaders(
  response: NextResponse,
  nonce: string,
  site = false,
): NextResponse {
  response.headers.set('Content-Security-Policy', cspFor(nonce, site))
  response.headers.set(
    'Strict-Transport-Security',
    'max-age=63072000; includeSubDomains; preload',
  )
  return response
}

/**
 * Page view/requisição vista pelo proxy (fonte `middleware` no Axiom): rota
 * normalizada, país/cidade (GeoLite2, a partir do X-Forwarded-For) e família
 * do navegador. O IP e o User-Agent cru não vão para o log (LGPD). Fora do
 * caminho da resposta (`waitUntil`).
 */
async function logProxyRequest(request: NextRequest): Promise<void> {
  logRequest(
    logger,
    {
      method: request.method,
      url: request.url,
      headers: request.headers,
      geo: await geolocateRequest(request.headers),
    },
    'middleware',
  )
  await logger.flush()
}

/**
 * HTTP status of a published-site page, decided before rendering (the App
 * Router answers 200 as soon as it starts streaming): a redirect of the
 * site answers 301/302, an unknown page or site a small 404 page
 * (`siteNotFoundHtml`), anything else renders normally.
 * Reads the route index from Redis; on any failure the page decides.
 */
async function siteRouteResponse(
  request: NextRequest,
  options: { slug: string; sitePath: string; viaHost: boolean; nonce: string },
): Promise<NextResponse | null> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null
  if (isSiteFilePath(options.sitePath)) return null
  const index = await SitePublicService.routeIndex(options.slug)
  if (!index.ok) return null
  const decision = decideSiteRoute(index.value, options.sitePath)
  if (decision.kind === 'page') return null
  const linkBase = siteLinkBase(options.slug, options.viaHost)
  if (decision.kind === 'not-found') {
    const html = siteNotFoundHtml({
      siteName: index.value.name,
      homeHref: index.value.published
        ? resolveSiteHref('/', linkBase)
        : undefined,
    })
    return withSecurityHeaders(
      new NextResponse(request.method === 'HEAD' ? null : html, {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }),
      options.nonce,
      true,
    )
  }
  const location = new URL(
    resolveSiteHref(decision.location, linkBase),
    request.nextUrl.origin,
  )
  return withSecurityHeaders(
    NextResponse.redirect(location, decision.permanent ? 301 : 302),
    options.nonce,
    true,
  )
}

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  event.waitUntil(logProxyRequest(request))

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  // O Next lê a CSP **da requisição** para carimbar o nonce nos `<script>`
  // que ele mesmo emite. Sem isto, com `strict-dynamic` o navegador ignora
  // `'self'`, bloqueia os chunks, a página não hidrata e nada é clicável.
  requestHeaders.set('Content-Security-Policy', buildCspHeader(nonce))

  const { pathname } = request.nextUrl
  // Only the proxy says what is a site request.
  requestHeaders.delete(SITE_REQUEST_HEADER)
  requestHeaders.delete(SITE_VIA_HOST_HEADER)

  // <slug>.<SITES_ROOT_DOMAIN>/<path> is served by /s/<slug>/<path>.
  const hostSlug = parseSiteHost(request.headers.get('host'), SITES_ROOT_DOMAIN)
  if (hostSlug) {
    const target = siteRewritePath(hostSlug, pathname)
    if (target) {
      requestHeaders.set(SITE_REQUEST_HEADER, hostSlug)
      requestHeaders.set(SITE_VIA_HOST_HEADER, '1')
      requestHeaders.set('Content-Security-Policy', cspFor(nonce, true))
      const url = request.nextUrl.clone()
      url.pathname = target
      const routed = await siteRouteResponse(request, {
        slug: hostSlug,
        sitePath: pathname,
        viaHost: true,
        nonce,
      })
      if (routed) return routed
      return withSecurityHeaders(
        NextResponse.rewrite(url, { request: { headers: requestHeaders } }),
        nonce,
        true,
      )
    }
  }
  const pathSlug = siteSlugFromPath(pathname)
  if (pathSlug) {
    requestHeaders.set(SITE_REQUEST_HEADER, pathSlug)
    requestHeaders.set('Content-Security-Policy', cspFor(nonce, true))
    const routed = await siteRouteResponse(request, {
      slug: pathSlug,
      sitePath: pathname.slice(`/s/${pathSlug}`.length) || '/',
      viaHost: false,
      nonce,
    })
    if (routed) return routed
  }

  if (
    NODE_ENV === 'development' &&
    (pathname === '/reference' || pathname === '/openapi.json' || pathname === '/testes')
  ) {
    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  const isPublic = PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  )

  if (isPublic) {
    return withSecurityHeaders(
      NextResponse.next({ request: { headers: requestHeaders } }),
      nonce,
      pathSlug !== null,
    )
  }

  const sessionToken =
    request.cookies.get('better-auth.session_token')?.value ||
    request.cookies.get('__Secure-better-auth.session_token')?.value

  if (!sessionToken) {
    // API routes should return 401, not redirect to the sign-in page.
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { success: false, statusCode: 401, error: { code: 'UNAUTHORIZED' } },
        { status: 401 },
      )
    }
    // Preserva o destino (path + query) para voltar após o login.
    const redirectTo = encodeURIComponent(pathname + request.nextUrl.search)
    return NextResponse.redirect(
      new URL(`/sign-in?redirect=${redirectTo}`, request.url),
    )
  }

  return withSecurityHeaders(
    NextResponse.next({ request: { headers: requestHeaders } }),
    nonce,
  )
}

export const config = {
  // Fora do proxy: assets do Next, ícones/imagens e `theme-init.js` (roda
  // antes da primeira pintura e precisa responder mesmo sem sessão). Nada de
  // excluir extensões em bloco: `/openapi.json`, por exemplo, continua
  // passando pelo gate de autenticação.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|theme-init.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)',
  ],
}
