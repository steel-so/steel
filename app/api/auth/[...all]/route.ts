import { toNextJsHandler } from 'better-auth/next-js'
import { withAxiom } from '@/lib/axiom/server'
import { auth } from '@/src/lib/auth'
import {
  ISSUER_METADATA_PATH,
  patchAuthServerMetadataResponse,
} from '@/src/lib/mcp/auth-server-metadata'
import { withGrantLifecycle } from '@/src/lib/mcp/token-lifecycle'
import {
  authLimiter,
  consume,
  oauthLimiter,
  oauthRegisterLimiter,
  otpLimiter,
} from '@/src/lib/rate-limit'
import { getClientIp } from '@/src/lib/rate-limit-helpers'
import { handleError } from '@/utils/http-response'

const PROTECTED_AUTH_PREFIXES = [
  '/api/auth/sign-in/',
  '/api/auth/sign-up/',
  '/api/auth/two-factor/',
  '/api/auth/request-password-reset',
  '/api/auth/reset-password',
  '/api/auth/email-otp/',
] as const

const TWO_FACTOR_OTP_PATHS = [
  '/api/auth/two-factor/send-otp',
  '/api/auth/two-factor/verify-otp',
] as const

function shouldRateLimit(pathname: string): boolean {
  return PROTECTED_AUTH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

function isTwoFactorOtpPath(pathname: string): boolean {
  return TWO_FACTOR_OTP_PATHS.some((path) => pathname === path)
}

async function getOtpRateKey(request: Request): Promise<string> {
  try {
    const session = await auth.api.getSession({ headers: request.headers })
    if (session?.user.id) return `user:${session.user.id}`
  } catch {
    // partial 2FA sessions surface as no full session — fall through
  }

  const cookieHeader = request.headers.get('cookie') ?? ''
  const match = cookieHeader.match(
    /(?:^|;\s*)(?:__Secure-)?better-auth\.two_factor=([^;]+)/,
  )
  if (match?.[1]) return `2fa-cookie:${match[1]}`

  return `ip:${getClientIp(request)}`
}

const OAUTH_PREFIX = '/api/auth/oauth2/'
const OAUTH_REGISTER_PATH = '/api/auth/oauth2/register'

/**
 * OAuth provider endpoints (authorize, token, register, revoke…, ADR 0033)
 * get their own per-IP budget. Better Auth's built-in limiter only runs in
 * production and keeps its counters in memory, per container.
 */
async function limitOAuth(request: Request, pathname: string) {
  if (!pathname.startsWith(OAUTH_PREFIX)) return null
  const ip = getClientIp(request)
  const limiter =
    pathname === OAUTH_REGISTER_PATH ? oauthRegisterLimiter : oauthLimiter
  const result = await consume(limiter, `${ip}:${pathname}`)
  return result.ok ? null : handleError(result.error)
}

const handler = toNextJsHandler(auth)

export const GET = withAxiom(async (request: Request) => {
  const pathname = new URL(request.url).pathname
  const limited = await limitOAuth(request, pathname)
  if (limited) return limited

  const response = await handler.GET(request)
  return pathname === ISSUER_METADATA_PATH
    ? patchAuthServerMetadataResponse(response)
    : response
})

export const POST = withAxiom(async (request: Request) => {
  const pathname = new URL(request.url).pathname

  const limited = await limitOAuth(request, pathname)
  if (limited) return limited

  if (shouldRateLimit(pathname)) {
    const ip = getClientIp(request)
    const result = await consume(authLimiter, `${ip}:${pathname}`)
    if (!result.ok) return handleError(result.error)
  }

  if (isTwoFactorOtpPath(pathname)) {
    const otpKey = await getOtpRateKey(request)
    const otpResult = await consume(otpLimiter, `${otpKey}:${pathname}`)
    if (!otpResult.ok) return handleError(otpResult.error)
  }

  // Revoke and refresh: retire a grant left without live tokens.
  return withGrantLifecycle(request, pathname, handler.POST)
})
