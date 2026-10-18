import type { ModuleKind } from '@prisma/client'
import type { NextRequest } from 'next/server'
import type { z } from 'zod'
import { runWithAuditContext } from '@/lib/axiom/audit-context'
import { withAxiom } from '@/lib/axiom/server'
import {
  apiTokenModuleNotAllowed,
  apiTokenScopeRequired,
  validationError,
} from '@/src/errors/app-error'
import { annotateRequest } from '@/src/lib/analytics/request-context'
import { type ApiSession, resolveApiSession } from '@/src/lib/api/session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import type { Result } from '@/src/lib/result'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

/** Dynamic segments of the route (`ticketId`, `broadcastId`...). */
type RouteParams = Record<string, string>

export interface V1HandlerInput<B, Q> {
  session: ApiSession
  params: RouteParams
  body: B
  query: Q
  /** Raw body of a `text` route (CSV); `''` otherwise. */
  text: string
}

interface V1RouteOptions<B, Q> {
  /** `write` requires the `api:write` scope (and the LGPD consent gate). */
  access: 'read' | 'write'
  /** Module the route belongs to: it must be in `session.modules`. */
  module?: ModuleKind
  /** Resource name for the consent gate (`'POST /api/v1/crm/leads'`). */
  consent?: string
  /** Query string schema (repeated keys become a list). */
  query?: z.ZodType<Q>
  /** JSON body schema. */
  body?: z.ZodType<B>
  /** Accept an empty body as `{}`. */
  allowEmptyBody?: boolean
  /**
   * Raw text body (CSV import) instead of JSON, up to `maxBytes`. Replaces
   * `body`: the handler receives it in `text`.
   */
  text?: { maxBytes: number }
  /** Success status (default 200). */
  status?: number
  handler: (input: V1HandlerInput<B, Q>) => Promise<Result<unknown>>
}

function queryObject(url: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  const { searchParams } = new URL(url)
  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key)
    out[key] = values.length > 1 ? values : values[0]
  }
  return out
}

/**
 * Handler of every `/api/v1/**` route (ADR 0035), a thin layer over the
 * existing services: `withAxiom` → personal token (`resolveApiSession`;
 * the session cookie never counts; it also consumes the per-token rate
 * limit) → rate limit per user →
 * scope (`api:write` for writes) → module of the token → consent (writes)
 * → Zod → service, run as the token's owner so RBAC and module access
 * behave as in the app. Mutations audited by the services carry
 * `source: 'api'` and the token id.
 */
export function apiV1Route<B = undefined, Q = undefined>(
  options: V1RouteOptions<B, Q>,
) {
  return withAxiom(
    async (request: NextRequest, ctx: { params: Promise<RouteParams> }) => {
      const resolved = await resolveApiSession(request)
      if (!resolved.ok) return handleError(resolved.error)
      const session = resolved.value

      // The per-token budget is consumed by `resolveApiSession` itself.
      const byUser = await consume(apiLimiter, `user:${session.userId}`)
      if (!byUser.ok) return handleError(byUser.error)

      if (options.access === 'write' && !session.scopes.includes('api:write')) {
        return handleError(apiTokenScopeRequired())
      }
      if (options.module && !session.modules.includes(options.module)) {
        return handleError(apiTokenModuleNotAllowed())
      }

      annotateRequest({
        userId: session.userId,
        workspaceId: session.workspaceId,
      })

      if (options.access === 'write' && options.consent) {
        const consent = await requireConsent(session.userId, options.consent)
        if (!consent.ok) return handleError(consent.error)
      }

      const params = await ctx.params

      let query = undefined as Q
      if (options.query) {
        const parsed = options.query.safeParse(queryObject(request.url))
        if (!parsed.success) {
          return standardError(
            'VALIDATION_ERROR',
            'Parâmetros inválidos',
            parsed.error.issues,
          )
        }
        query = parsed.data
      }

      let body = undefined as B
      let raw = ''
      if (options.text) {
        const text = await request.text().catch(() => '')
        if (!text.trim()) {
          return handleError(validationError('Envie o conteúdo no corpo'))
        }
        if (Buffer.byteLength(text) > options.text.maxBytes) {
          return handleError(
            validationError(
              `Corpo maior que ${Math.floor(options.text.maxBytes / 1024 / 1024)} MB`,
            ),
          )
        }
        raw = text
      } else if (options.body) {
        const json = await readJsonBody(request, {
          allowEmpty: options.allowEmptyBody,
        })
        if (!json.ok) return handleError(json.error)
        const parsed = options.body.safeParse(json.value)
        if (!parsed.success) {
          return standardError(
            'VALIDATION_ERROR',
            'Dados inválidos',
            parsed.error.issues,
          )
        }
        body = parsed.data
      }

      const result = await runWithAuditContext(
        { source: 'api', apiTokenId: session.tokenId },
        () => options.handler({ session, params, body, query, text: raw }),
      )
      if (!result.ok) return handleError(result.error)
      return successResponse(result.value ?? null, options.status ?? 200)
    },
  )
}
