import type { z } from 'zod'
import { validationError } from '@/src/errors'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { getClientIp } from '@/src/lib/rate-limit-helpers'
import { err, ok, type Result } from '@/src/lib/result'
import { readJsonBody } from '@/utils/http-request'

/**
 * Boilerplate shared by the routes of the CRM deal tools (nov: crm-deals):
 * session, rate limit and (for writes) the LGPD consent gate. Returns the
 * user id so the route can hand it to the service.
 */
export async function authorizedUser(
  consentLabel?: string,
): Promise<Result<string>> {
  const auth = await getAuthSession()
  if (!auth.ok) return auth

  const userId = auth.value.user.id
  const limit = await consume(apiLimiter, `user:${userId}`)
  if (!limit.ok) return limit

  if (consentLabel) {
    const consent = await requireConsent(userId, consentLabel)
    if (!consent.ok) return consent
  }
  return ok(userId)
}

/** JSON body validated by a Zod schema (an empty body counts as `{}`). */
export async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<Result<z.infer<S>>> {
  const json = await readJsonBody(request, { allowEmpty: true })
  if (!json.ok) return json
  const parsed = schema.safeParse(json.value)
  if (!parsed.success) {
    return err(validationError('Dados inválidos', parsed.error.issues))
  }
  return ok(parsed.data)
}

/** Query string validated by a Zod schema. */
export function parseQuery<S extends z.ZodType>(
  request: Request,
  schema: S,
): Result<z.infer<S>> {
  const { searchParams } = new URL(request.url)
  const parsed = schema.safeParse(Object.fromEntries(searchParams.entries()))
  if (!parsed.success) {
    return err(validationError('Parâmetros inválidos', parsed.error.issues))
  }
  return ok(parsed.data)
}

/** Rate limit of a public route by client IP; resolves to the IP. */
export async function publicIp(
  request: Request,
  bucket: string,
): Promise<Result<string>> {
  const ip = getClientIp(request)
  const limit = await consume(apiLimiter, `${bucket}:${ip}`)
  if (!limit.ok) return limit
  return ok(ip)
}
