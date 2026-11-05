import {
  NEXT_PUBLIC_SENTRY_ENVIRONMENT,
  NEXT_PUBLIC_SENTRY_RELEASE,
  NODE_ENV,
} from '@/lib/env/env'
import { scrubBreadcrumb, scrubEvent } from './scrub'

/**
 * As opções que todo runtime do `Sentry.init` compartilha.
 *
 * Divisão de trabalho com o Axiom, para os dois não reportarem a mesma coisa
 * duas vezes e deixarem ambos inúteis:
 *
 * - **Axiom** é o log do que aconteceu: uma linha por requisição
 *   (`withAxiom`, `logRequest`), a trilha de auditoria LGPD
 *   (`auditMutation` / `auditAuth`), web vitals e os `logger.error` que os
 *   serviços emitem para falhas que eles **trataram** — rate limit atingido,
 *   webhook do Meta que expirou, erro do Prisma já mapeado para um
 *   `AppError`. São desfechos esperados, com resposta HTTP; a gente consulta,
 *   não alerta.
 * - **Sentry** é a caixa de entrada do que quebrou: exceções que ninguém
 *   pegou. Chegam lá pelo `onRequestError` do Next (crash de render, de route
 *   handler, de server action ou do proxy) e pelos handlers globais do
 *   navegador — nunca por um `logger.error`. Como os serviços devolvem
 *   `Result` em vez de lançar (ADR 0002), um `AppError` mapeado por
 *   `handleError` nunca vira issue no Sentry, e é exatamente esse o ponto: a
 *   lista de issues continua sendo uma lista de bugs.
 *
 * Tracing: o Axiom guarda os traces (`lib/otel/axiom-traces.ts`) e o Sentry só
 * os erros. Com `AXIOM_TRACES_TOKEN` o servidor amostra `TRACES_SAMPLE_RATE` e
 * descarta as transações antes de chegarem ao Sentry; sem o token, o Sentry
 * amostra 10% em produção e fica desligado em todo o resto.
 */
function baseOptions(dsn: string) {
  return {
    dsn,
    environment: NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? NODE_ENV,
    release: NEXT_PUBLIC_SENTRY_RELEASE,
    // Sem IP, sem cookies, sem corpo da requisição, sem inferência de
    // user agent.
    sendDefaultPii: false,
    // 10% dá a tendência que os painéis de Next.js/Queries/Web Vitals
    // desenham sem gastar a cota; erros são capturados independentemente
    // desta taxa.
    tracesSampleRate: NODE_ENV === 'production' ? 0.1 : 0,
    // O console do próprio SDK cairia no Axiom como ruído.
    debug: false,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
    ignoreErrors: [
      // Fluxo de controle do App Router, não falha.
      'NEXT_REDIRECT',
      'NEXT_NOT_FOUND',
      'NEXT_HTTP_ERROR_FALLBACK',
      // Navegação que saiu no meio da requisição; não há o que corrigir.
      'AbortError',
      'The operation was aborted',
    ],
  }
}

/** Navegador. Session Replay fica desligado: ele grava o DOM. */
export function clientSentryOptions(dsn: string) {
  return {
    ...baseOptions(dsn),
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    sendClientReports: false,
  }
}

/** Runtime Node (route handlers, server components, server actions). */
export function serverSentryOptions(dsn: string) {
  return baseOptions(dsn)
}

/** Runtime edge — é onde o `proxy.ts` roda (gate de auth, CSP, log). */
export function edgeSentryOptions(dsn: string) {
  return baseOptions(dsn)
}
