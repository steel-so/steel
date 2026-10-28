import { createRequire } from "node:module";
import path from "node:path";
import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import { EXCALIDRAW_ASSET_PATH } from "./lib/excalidraw/asset-path";
import { syncExcalidrawFonts } from "./lib/excalidraw/sync-fonts";
import {
  POSTHOG_DEFAULT_HOST,
  POSTHOG_PROXY_PATH,
  posthogAssetHost,
} from "./lib/posthog/constants";

// Fontes do Excalidraw (bloco de desenho da Wiki) servidas desta origem, em
// vez do esm.sh que o `font-src 'self'` bloqueia. Roda sempre que o Next lê
// este config (`next dev`, `next build`, o build do Dockerfile), antes de o
// public/ ser lido, e só recopia quando a versão do pacote muda. O servidor
// standalone embute o config, então produção não toca no disco por isso.
syncExcalidrawFonts({
  packageDir: path.dirname(
    path.dirname(
      path.dirname(createRequire(__filename).resolve("@excalidraw/excalidraw")),
    ),
  ),
  targetDir: path.join(__dirname, "public", EXCALIDRAW_ASSET_PATH),
});

// Headers estáticos aplicados a toda resposta (inclusive rotas fora do matcher
// do proxy). CSP com nonce continua no proxy.ts; HSTS também é enviado lá, mas
// fica aqui como defesa em profundidade caso o proxy não rode.
// X-Frame-Options duplica o `frame-ancestors 'none'` da CSP para navegadores
// antigos e scanners (job de headers do Security DAST).
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(self), geolocation=(), browsing-topics=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
]

const staticAssetCsp =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none';"

const staticAssetHeaders = [
  ...securityHeaders,
  { key: 'Content-Security-Policy', value: staticAssetCsp },
]

// --- Proxy reverso do PostHog ------------------------------------------------
// O navegador só conversa com `/ingest/*` na nossa própria origem, e o Next
// reescreve para o PostHog. Isso compra duas coisas: o `connect-src` da CSP
// continua em `'self'` (nenhum host de terceiro na política — o que importa
// porque a CSP do Steel não tem `'strict-dynamic'`, ADR 0011, e cada origem
// nova teria de ser nomeada à mão), e as requisições sobrevivem às
// blocklists que reconhecem `*.i.posthog.com` pelo nome. O custo é que o
// tráfego de analytics transita pelo nosso servidor — aceitável para o
// volume que esta configuração permite (page view e evento nomeado, sem
// autocapture e sem recording).
//
// Existe só quando há chave configurada, então um deploy sem PostHog não tem
// rota `/ingest`, nem rewrite externo, nem mudança de trailing slash.
const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;

// Set by the Dockerfile (on unless the build passes NEXT_BUILD_LOW_MEMORY=false);
// see `experimental` below.
const lowMemoryBuild = process.env.NEXT_BUILD_LOW_MEMORY === "true";
const posthogHost =
  process.env.NEXT_PUBLIC_POSTHOG_HOST || POSTHOG_DEFAULT_HOST;

const posthogProxy = posthogKey
  ? {
      // Todo endpoint do posthog-js termina em barra (`/e/`, `/i/`, `/s/`).
      // A normalização de trailing slash do Next responderia cada um com 308
      // antes de o rewrite ser consultado, transformando cada evento em duas
      // viagens.
      skipTrailingSlashRedirect: true,
      rewrites: async () => [
        {
          source: `${POSTHOG_PROXY_PATH}/static/:path*`,
          destination: `${posthogAssetHost(posthogHost)}/static/:path*`,
        },
        {
          source: `${POSTHOG_PROXY_PATH}/:path*`,
          destination: `${posthogHost}/:path*`,
        },
      ],
    }
  : {};

// --- Sentry ------------------------------------------------------------------
// Source maps sobem só quando o build recebe credenciais, o que é o build de
// imagem do CD e nada mais: CI, `pnpm build` numa máquina local e qualquer
// build de fork rodam sem nenhuma dessas e não podem falhar por isso.
const sentryOrg = process.env.SENTRY_ORG;
const sentryProject = process.env.SENTRY_PROJECT;
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;
const canUploadSourcemaps = Boolean(
  sentryOrg && sentryProject && sentryAuthToken,
);

const nextConfig: NextConfig = {
  ...posthogProxy,
  // CRM landing pages moved into CRM › Sites (old builder links resolve in
  // `crm/landing-pages/[id]/page.tsx`, which needs the database).
  redirects: async () => [
    {
      source: '/:workspace/crm/landing-pages',
      destination: '/:workspace/crm/sites',
      permanent: false,
    },
  ],
  poweredByHeader: false,
  output: 'standalone',
  // The proxy in front compresses instead (Apache on homologação,
  // infra/nginx/steel-gzip.conf elsewhere): gzipping every response in the
  // Node process cost Nexo more CPU than rendering a prerendered page, and
  // with several replicas CPU is the budget that matters (ADR 0038).
  compress: false,
  // O Turbopack não emite source map de navegador sem pedido, e o plugin do
  // Sentry não pede por nós: sem isto ele criaria o release e não teria nada
  // para subir, deixando todo stack trace de cliente minificado. Amarrado às
  // credenciais de upload de propósito — os mapas não podem ser emitidos onde
  // nada vai apagá-los depois. No build do CD,
  // `sourcemaps.deleteSourcemapsAfterUpload` remove os arquivos e tira os
  // comentários `sourceMappingURL` depois que o Sentry os tem, então os traces
  // ficam legíveis no Sentry e ilegíveis no navegador.
  productionBrowserSourceMaps: canUploadSourcemaps,
  serverExternalPackages: ['@prisma/client'],
  // The public changelog (`content/changelog/*.mdx`), the user manual
  // (`content/docs/**/*.mdx`) and the developer guides (`content/dev/**/*.mdx`)
  // are read at runtime and the standalone trace
  // does not follow a `readdir`, so the files are added to the image here
  // (their pages, sitemap, RSS and llms*.txt need them).
  outputFileTracingIncludes: {
    '/**': [
      './content/changelog/**/*',
      './content/docs/**/*',
      './content/dev/**/*',
    ],
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
      },
      {
        protocol: 'https',
        hostname: 'steel.stratustelecom.com.br'
      },
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '9000',
        pathname: '/{avatars,user-covers}/**',
      }
    ],
  },
  cacheComponents: true,
  // `'use cache'` keeps Next's in-memory LRU per replica, but revalidateTag()
  // on one replica must expire the entry on all of them: the handler shares
  // the tag state through Redis (lib/next-cache, ADR 0038). Loaded at runtime
  // without bundling, so it is plain CommonJS.
  cacheHandlers: {
    default: createRequire(__filename).resolve('./lib/next-cache/handler.cjs'),
  },
  turbopack: {
    rules: {
      // Aponta o fallback fixo do esm.sh nas fontes do Excalidraw para a cópia
      // auto-hospedada acima; ver lib/excalidraw/cdn-fallback-loader.cjs.
      "*.js": {
        condition: {
          all: [
            "browser",
            { path: /@excalidraw\/excalidraw\/dist\// },
            { content: /ASSETS_FALLBACK_URL/ },
          ],
        },
        loaders: [
          {
            loader: path.join(__dirname, "lib/excalidraw/cdn-fallback-loader.cjs"),
            options: { assetPath: EXCALIDRAW_ASSET_PATH },
          },
        ],
      },
    },
  },
  experimental: {
    webpackMemoryOptimizations: true,
    // The app has one root layout per top-level group (Steel screens and
    // the published customer sites, app/(sites)); `app/global-not-found.tsx`
    // answers URLs that match no route at all.
    globalNotFound: true,
    // Next 16.4 turned the Turbopack shared runtime on by default: it drops
    // the per-route runtime chunk and inlines the route's chunk-group
    // bootstrap into the HTML as `<script id="_R_">`. With Cache Components
    // that script lands in the static shell prerendered at build time, where
    // no request (and so no CSP nonce) exists, so `script-src 'self'
    // 'nonce-…'` blocks it and the page never hydrates. Off, the bootstrap is
    // a same-origin `<script src>` again, covered by `'self'` like every other
    // chunk. The e2e `app/(public)/__tests__/csp-hydration.e2e.test.ts` fails
    // if an inline script without the nonce comes back.
    // turbopackSharedRuntime: false, (negative control: 16.4 default)
    // Low-memory mode, only for image builds on the ~3.8GB self-hosted runner
    // (still used by promote-production.yml; CI/CD build on 16GB hosted
    // runners since ADR 0009). There, Turbopack grows until the OOM killer
    // ends the build, and "Collecting page data" opens one worker per CPU,
    // each loading the whole app. Elsewhere these limits only slow the build
    // down: eviction pages the Turbopack cache to disk and two workers
    // serialize page data collection.
    ...(lowMemoryBuild && {
      // 'full' made Turbopack segfault/panic in the docker build; 'auto' is stable.
      turbopackMemoryEviction: 'auto' as const,
      cpus: 2,
      memoryBasedWorkersCount: true,
    }),
  },
  typescript: {
    ignoreBuildErrors: true
  },
  headers: async () => [
    {
      source: '/_next/static/:path*',
      headers: staticAssetHeaders,
    },
    {
      source: '/favicon.ico',
      headers: staticAssetHeaders,
    },
    {
      source: '/:path*\\.(svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|otf)',
      headers: staticAssetHeaders,
    },
    {
      source: '/(.*)',
      headers: securityHeaders,
    },
  ],
};

export default withSentryConfig(nextConfig, {
  org: sentryOrg,
  project: sentryProject,
  authToken: sentryAuthToken,
  silent: !process.env.CI,
  telemetry: false,
  // `disableLogger` / `automaticVercelMonitors` ficam de fora de propósito:
  // os dois são opções só de webpack e este projeto builda com Turbopack, e
  // não deployamos na Vercel.
  widenClientFileUpload: false,
  release: {
    // O SHA do git que o build do CD já conhece (build arg do Dockerfile),
    // para uma issue apontar o commit que a embarcou.
    name: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    create: canUploadSourcemaps,
    finalize: canUploadSourcemaps,
  },
  sourcemaps: {
    disable: !canUploadSourcemaps,
    deleteSourcemapsAfterUpload: true,
  },
  bundleSizeOptimizations: {
    excludeDebugStatements: true,
    excludeReplayShadowDom: true,
    excludeReplayIframe: true,
    excludeReplayWorker: true,
  },
  // Problema de credencial, oscilação de rede ou rate limit do lado do Sentry
  // nunca podem virar deploy quebrado. O build continua e avisa.
  errorHandler: (error) => {
    console.warn(`[sentry] source map upload skipped: ${error.message}`);
  },
});
