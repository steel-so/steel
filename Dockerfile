FROM node:22-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./

RUN --mount=type=secret,id=hugeicons_token \
    corepack enable pnpm && \
    if [ -f /run/secrets/hugeicons_token ]; then \
      echo "@hugeicons-pro:registry=https://npm.hugeicons.com" > .npmrc && \
      echo "//npm.hugeicons.com/:_authToken=$(cat /run/secrets/hugeicons_token)" >> .npmrc; \
    fi && \
    pnpm install --frozen-lockfile && \
    rm -f .npmrc

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

ARG NEXT_PUBLIC_URL=https://steel.stratustelecom.com.br
ENV NEXT_PUBLIC_URL=$NEXT_PUBLIC_URL

ARG NEXT_PUBLIC_AXIOM_TOKEN
ENV NEXT_PUBLIC_AXIOM_TOKEN=$NEXT_PUBLIC_AXIOM_TOKEN

ARG NEXT_PUBLIC_AXIOM_DATASET
ENV NEXT_PUBLIC_AXIOM_DATASET=$NEXT_PUBLIC_AXIOM_DATASET

# Observabilidade (Sentry + PostHog). Estas PRECISAM existir no build, não só
# no .env do servidor: verificado no navegador com build de produção — um DSN
# definido apenas em runtime chega ao servidor, ao edge e à CSP do proxy.ts,
# mas NÃO ao navegador (`window.__SENTRY__` indefinido, nenhuma requisição de
# ingestão depois de um erro não tratado). A chave do PostHog é lida pelo
# próprio next.config.ts, para montar o rewrite de `/ingest`, que é build time
# por definição.
#
# Todas são opcionais: sem elas o build passa igual e as duas integrações
# ficam inertes (ADR 0017).
ARG NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN

ARG NEXT_PUBLIC_META_APP_ID
ENV NEXT_PUBLIC_META_APP_ID=$NEXT_PUBLIC_META_APP_ID

ARG NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID
ENV NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID=$NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID

ARG NEXT_PUBLIC_SENTRY_RELEASE
ENV NEXT_PUBLIC_SENTRY_RELEASE=$NEXT_PUBLIC_SENTRY_RELEASE

ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT
ENV NEXT_PUBLIC_SENTRY_ENVIRONMENT=$NEXT_PUBLIC_SENTRY_ENVIRONMENT

ARG NEXT_PUBLIC_POSTHOG_KEY
ENV NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY

ARG NEXT_PUBLIC_POSTHOG_HOST
ENV NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST

# Upload de source map do Sentry. `SENTRY_ORG`/`SENTRY_PROJECT` não são
# segredo; o token é, e entra como secret mount (mesmo padrão do
# hugeicons_token) para não ficar numa camada da imagem. Sem os três o plugin
# do next.config.ts fica inerte e o build segue.
ARG SENTRY_ORG
ENV SENTRY_ORG=$SENTRY_ORG

ARG SENTRY_PROJECT
ENV SENTRY_PROJECT=$SENTRY_PROJECT

ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
ENV SKIP_ENV_VALIDATION="true"

# Teto do heap do V8 no build. O padrão 2048 cabe numa máquina pequena; o CD,
# que builda num runner hospedado, passa um valor maior via build-arg. Sem
# teto, prisma generate/esbuild crescem até o OOM killer matar o processo.
# Atenção: isto limita só o V8 — a memória do Turbopack não entra aqui, e é
# ela que estourou no servidor (ADR 0009).
ARG NODE_BUILD_MEMORY=2048
ENV NODE_OPTIONS="--max-old-space-size=${NODE_BUILD_MEMORY}"

# Caps Turbopack memory and the page-data workers (next.config.ts). On by
# default for the small self-hosted runner; the 16GB hosted runners turn it off.
ARG NEXT_BUILD_LOW_MEMORY=true
ENV NEXT_BUILD_LOW_MEMORY=$NEXT_BUILD_LOW_MEMORY

RUN --mount=type=secret,id=sentry_auth_token \
    corepack enable pnpm && \
    if [ -f /run/secrets/sentry_auth_token ]; then \
      export SENTRY_AUTH_TOKEN="$(cat /run/secrets/sentry_auth_token)"; \
    fi && \
    pnpm prisma:generate && \
    pnpm build && \
    pnpm worker:build && \
    pnpm realtime:build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# node:20-alpine bundles npm (and its vendored tar dependency) even though
# this stage only ever runs `node server.js` directly — strip the unused
# npm/corepack/npx toolchain so a vulnerable transitive tar version doesn't
# show up in image scans for a binary we never invoke here.
RUN rm -rf /usr/local/lib/node_modules/npm \
    /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm \
    /usr/local/bin/npx \
    /usr/local/bin/corepack

# pg_dump/pg_restore usados pelo worker para backup/restore do banco —
# versão do pacote tem que casar com o major do postgres:17-alpine usado em produção.
# ffmpeg/ffprobe usados pelo worker para normalizar vídeo antes do publish no
# Instagram (remove edit list e garante moov no início — exigência da Meta).
RUN apk add --no-cache postgresql17-client ffmpeg

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/dist ./dist

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
