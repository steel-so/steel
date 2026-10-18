import {
  RateLimiterMemory,
  RateLimiterRedis,
  RateLimiterRes,
} from 'rate-limiter-flexible'
import { logger } from '@/lib/axiom/logger'
import type { AppError } from '@/src/errors/app-error'
import { rateLimited } from '@/src/errors/app-error'
import { ensureRedisConnected, redis } from '@/src/lib/redis'
import type { Result } from '@/src/lib/result'
import { err, ok } from '@/src/lib/result'

const AUTH_POINTS = 10
const AUTH_DURATION_SECONDS = 15 * 60
const AUTH_BLOCK_SECONDS = 30 * 60

const OTP_POINTS = 5
const OTP_DURATION_SECONDS = 15 * 60

const EMAIL_POINTS = 5
const EMAIL_DURATION_SECONDS = 60 * 60

const API_POINTS = 100
const API_DURATION_SECONDS = 60

const EXPORT_POINTS = 1
const EXPORT_DURATION_SECONDS = 24 * 60 * 60

const UPLOAD_POINTS = 10
const UPLOAD_DURATION_SECONDS = 60

const WHATSAPP_SEND_POINTS = 20
const WHATSAPP_SEND_DURATION_SECONDS = 60

const WHATSAPP_WEBHOOK_POINTS = 120
const WHATSAPP_WEBHOOK_DURATION_SECONDS = 60

// Portal do contato externo do ServiceDesk (sem sessão do Better Auth):
// pedir o link mágico é caro (manda e-mail) e abrir/responder chamado é
// escrita — os dois são limitados por IP **e** por e-mail/contato.
const SD_PORTAL_LINK_POINTS = 5
const SD_PORTAL_LINK_DURATION_SECONDS = 60 * 60

const SD_PORTAL_WRITE_POINTS = 20
const SD_PORTAL_WRITE_DURATION_SECONDS = 10 * 60

// Steel AI: each message can run up to 8 model rounds, so it gets its own,
// much tighter budget than the generic API limiter (the monthly USD quota
// still applies on top).
const AI_MESSAGE_POINTS = 20
const AI_MESSAGE_DURATION_SECONDS = 60

// Public MCP server (ADR 0032): one budget per user and a wider one per OAuth
// client, so a single runaway client can't exhaust every user it serves.
const MCP_USER_POINTS = 120
const MCP_USER_DURATION_SECONDS = 60

const MCP_CLIENT_POINTS = 600
const MCP_CLIENT_DURATION_SECONDS = 60

// OAuth provider (ADR 0033), per IP and endpoint. AI clients call the token
// endpoint from shared egress IPs (every Claude user behind the same few
// addresses), so it gets a roomier budget than the sign-in limiter; dynamic
// client registration creates rows and is kept tight.
const OAUTH_POINTS = 60
const OAUTH_DURATION_SECONDS = 60

const OAUTH_REGISTER_POINTS = 10
const OAUTH_REGISTER_DURATION_SECONDS = 60 * 60

const authInsurance = new RateLimiterMemory({
  points: AUTH_POINTS,
  duration: AUTH_DURATION_SECONDS,
  blockDuration: AUTH_BLOCK_SECONDS,
  keyPrefix: 'rl:auth:mem',
})

export const authLimiter = new RateLimiterRedis({
  storeClient: redis,
  storeType: 'redis',
  useRedisPackage: true,
  keyPrefix: 'rl:auth',
  points: AUTH_POINTS,
  duration: AUTH_DURATION_SECONDS,
  blockDuration: AUTH_BLOCK_SECONDS,
  insuranceLimiter: authInsurance,
})

const otpInsurance = new RateLimiterMemory({
  points: OTP_POINTS,
  duration: OTP_DURATION_SECONDS,
  keyPrefix: 'rl:otp:mem',
})

export const otpLimiter = new RateLimiterRedis({
  storeClient: redis,
  storeType: 'redis',
  useRedisPackage: true,
  keyPrefix: 'rl:otp',
  points: OTP_POINTS,
  duration: OTP_DURATION_SECONDS,
  insuranceLimiter: otpInsurance,
})

export const emailLimiter = new RateLimiterRedis({
  storeClient: redis,
  storeType: 'redis',
  useRedisPackage: true,
  keyPrefix: 'rl:email',
  points: EMAIL_POINTS,
  duration: EMAIL_DURATION_SECONDS,
})

export const apiLimiter = new RateLimiterRedis({
  storeClient: redis,
  storeType: 'redis',
  useRedisPackage: true,
  keyPrefix: 'rl:api',
  points: API_POINTS,
  duration: API_DURATION_SECONDS,
})

export const exportLimiter = new RateLimiterRedis({
  storeClient: redis,
  storeType: 'redis',
  useRedisPackage: true,
  keyPrefix: 'rl:export',
  points: EXPORT_POINTS,
  duration: EXPORT_DURATION_SECONDS,
})

export const uploadLimiter = new RateLimiterRedis({
  storeClient: redis,
  storeType: 'redis',
  useRedisPackage: true,
  keyPrefix: 'rl:upload',
  points: UPLOAD_POINTS,
  duration: UPLOAD_DURATION_SECONDS,
})

export const whatsappSendLimiter = new RateLimiterRedis({
  storeClient: redis,
  storeType: 'redis',
  useRedisPackage: true,
  keyPrefix: 'rl:whatsapp:send',
  points: WHATSAPP_SEND_POINTS,
  duration: WHATSAPP_SEND_DURATION_SECONDS,
})

export const whatsappWebhookLimiter = new RateLimiterRedis({
  storeClient: redis,
  storeType: 'redis',
  useRedisPackage: true,
  keyPrefix: 'rl:whatsapp:webhook',
  points: WHATSAPP_WEBHOOK_POINTS,
  duration: WHATSAPP_WEBHOOK_DURATION_SECONDS,
})

export const sdPortalLinkLimiter = new RateLimiterRedis({
  storeClient: redis,
  storeType: 'redis',
  useRedisPackage: true,
  keyPrefix: 'rl:sd:portal:link',
  points: SD_PORTAL_LINK_POINTS,
  duration: SD_PORTAL_LINK_DURATION_SECONDS,
})

export const sdPortalWriteLimiter = new RateLimiterRedis({
  storeClient: redis,
  storeType: 'redis',
  useRedisPackage: true,
  keyPrefix: 'rl:sd:portal:write',
  points: SD_PORTAL_WRITE_POINTS,
  duration: SD_PORTAL_WRITE_DURATION_SECONDS,
})

export const aiMessageLimiter = new RateLimiterRedis({
  storeClient: redis,
  storeType: 'redis',
  useRedisPackage: true,
  keyPrefix: 'rl:ai:message',
  points: AI_MESSAGE_POINTS,
  duration: AI_MESSAGE_DURATION_SECONDS,
})

export const mcpUserLimiter = new RateLimiterRedis({
  storeClient: redis,
  storeType: 'redis',
  useRedisPackage: true,
  keyPrefix: 'rl:mcp:user',
  points: MCP_USER_POINTS,
  duration: MCP_USER_DURATION_SECONDS,
})

export const mcpClientLimiter = new RateLimiterRedis({
  storeClient: redis,
  storeType: 'redis',
  useRedisPackage: true,
  keyPrefix: 'rl:mcp:client',
  points: MCP_CLIENT_POINTS,
  duration: MCP_CLIENT_DURATION_SECONDS,
})

export const oauthLimiter = new RateLimiterRedis({
  storeClient: redis,
  storeType: 'redis',
  useRedisPackage: true,
  keyPrefix: 'rl:oauth',
  points: OAUTH_POINTS,
  duration: OAUTH_DURATION_SECONDS,
})

export const oauthRegisterLimiter = new RateLimiterRedis({
  storeClient: redis,
  storeType: 'redis',
  useRedisPackage: true,
  keyPrefix: 'rl:oauth:register',
  points: OAUTH_REGISTER_POINTS,
  duration: OAUTH_REGISTER_DURATION_SECONDS,
})

export type Limiter = RateLimiterRedis

const limiterNames = new WeakMap<Limiter, string>([
  [authLimiter, 'auth'],
  [otpLimiter, 'otp'],
  [emailLimiter, 'email'],
  [apiLimiter, 'api'],
  [exportLimiter, 'export'],
  [uploadLimiter, 'upload'],
  [whatsappSendLimiter, 'whatsapp_send'],
  [whatsappWebhookLimiter, 'whatsapp_webhook'],
  [sdPortalLinkLimiter, 'sd_portal_link'],
  [sdPortalWriteLimiter, 'sd_portal_write'],
  [aiMessageLimiter, 'ai_message'],
  [mcpUserLimiter, 'mcp_user'],
  [mcpClientLimiter, 'mcp_client'],

  [oauthLimiter, 'oauth'],
  [oauthRegisterLimiter, 'oauth_register'],
])

let connectionEnsured: Promise<unknown> | null = null

async function ensureConnection() {
  if (!connectionEnsured) {
    connectionEnsured = ensureRedisConnected().catch((cause) => {
      connectionEnsured = null
      throw cause
    })
  }
  return connectionEnsured
}

export async function consume(
  limiter: Limiter,
  key: string,
  points = 1,
): Promise<Result<void, AppError>> {
  const name = limiterNames.get(limiter) ?? 'unknown'

  try {
    await ensureConnection()
    await limiter.consume(key, points)
    return ok(undefined)
  } catch (cause) {
    if (cause instanceof RateLimiterRes) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil(cause.msBeforeNext / 1000),
      )
      logger.warn('rate_limit_violation', {
        limiter: name,
        key,
        retryAfterSeconds,
        consumedPoints: cause.consumedPoints,
      })
      return err(rateLimited(retryAfterSeconds))
    }

    logger.error('rate_limit_store_error', {
      limiter: name,
      key,
      message: cause instanceof Error ? cause.message : String(cause),
    })
    return ok(undefined)
  }
}
