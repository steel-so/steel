import 'server-only'
import { randomInt } from 'node:crypto'
import { logger } from '@/lib/axiom/logger'
import {
  whatsappProviderError,
  whatsappSignupNameNotApproved,
  whatsappSignupPaymentRequired,
  whatsappSignupPermissionDenied,
} from '@/src/errors'
import type { AppError } from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'
import { META_GRAPH_BASE_URL } from './meta-client'

/**
 * Server side of the WhatsApp Embedded Signup: code -> business token,
 * app subscription on the WABA, Cloud API registration of the number and the
 * lookup of its display data. Tokens, codes and PINs are never logged.
 */

interface GraphErrorBody {
  error?: {
    message?: string
    code?: number
    error_subcode?: number
    error_user_msg?: string
  }
}

export interface MetaSignupApp {
  appId: string
  appSecret: string
}

export interface MetaPhoneInfo {
  displayPhoneNumber: string
  verifiedName: string | null
}

/** Random 6-digit two-step verification PIN, zero padded. */
export function generateRegistrationPin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

/** Maps a Graph error to a pt-BR user-facing `AppError`. */
export function mapMetaSignupError(
  body: GraphErrorBody | null,
  step: string,
): AppError {
  const code = body?.error?.code
  const subcode = body?.error?.error_subcode
  const message = body?.error?.message ?? ''
  if (code === 141006 || subcode === 141006) {
    return whatsappSignupPaymentRequired()
  }
  if (
    code === 131037 ||
    /display name/i.test(message) ||
    /display name/i.test(body?.error?.error_user_msg ?? '')
  ) {
    return whatsappSignupNameNotApproved()
  }
  if (code === 200 || code === 10 || code === 190) {
    return whatsappSignupPermissionDenied()
  }
  logger.warn('whatsapp.meta.signup_failed', { step, code, subcode })
  return whatsappProviderError(
    `A Meta recusou a etapa "${step}" da conexão. Tente de novo ou use o cadastro manual.`,
  )
}

async function graph<T>(
  path: string,
  init: RequestInit & { token?: string },
): Promise<{ ok: true; body: T } | { ok: false; body: GraphErrorBody | null }> {
  const { token, ...rest } = init
  try {
    const response = await fetch(`${META_GRAPH_BASE_URL}${path}`, {
      ...rest,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
    const body = await response.json().catch(() => null)
    if (!response.ok) return { ok: false, body: body as GraphErrorBody | null }
    return { ok: true, body: body as T }
  } catch {
    return { ok: false, body: null }
  }
}

/** Exchanges the Embedded Signup `code` for a business integration token. */
export async function exchangeSignupCode(
  app: MetaSignupApp,
  code: string,
): Promise<Result<string, AppError>> {
  const query = new URLSearchParams({
    client_id: app.appId,
    client_secret: app.appSecret,
    code,
  })
  const res = await graph<{ access_token?: string }>(
    `/oauth/access_token?${query.toString()}`,
    { method: 'GET' },
  )
  if (!res.ok) return err(mapMetaSignupError(res.body, 'troca do código'))
  if (!res.body.access_token) {
    return err(mapMetaSignupError(null, 'troca do código'))
  }
  return ok(res.body.access_token)
}

/** Subscribes our app to the WABA webhooks. Idempotent on Meta's side. */
export async function subscribeAppToWaba(
  token: string,
  wabaId: string,
): Promise<Result<true, AppError>> {
  const res = await graph(`/${wabaId}/subscribed_apps`, {
    method: 'POST',
    token,
  })
  if (!res.ok) return err(mapMetaSignupError(res.body, 'inscrição de webhooks'))
  return ok(true)
}

/**
 * Registers the number on the Cloud API. "Already registered" counts as
 * success (the customer may have onboarded the number before).
 */
export async function registerPhoneNumber(
  token: string,
  phoneNumberId: string,
  pin: string,
): Promise<Result<true, AppError>> {
  const res = await graph(`/${phoneNumberId}/register`, {
    method: 'POST',
    token,
    body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
  })
  if (res.ok) return ok(true)
  const message = res.body?.error?.message ?? ''
  if (/already.{0,20}regist/i.test(message)) return ok(true)
  return err(mapMetaSignupError(res.body, 'registro do número'))
}

/** Reads the number's display data. */
export async function fetchPhoneInfo(
  token: string,
  phoneNumberId: string,
): Promise<Result<MetaPhoneInfo, AppError>> {
  const res = await graph<{
    display_phone_number?: string
    verified_name?: string
  }>(`/${phoneNumberId}?fields=display_phone_number,verified_name`, {
    method: 'GET',
    token,
  })
  if (!res.ok) return err(mapMetaSignupError(res.body, 'leitura do número'))
  const digits = (res.body.display_phone_number ?? '').replace(/\D/g, '')
  if (!digits) return err(mapMetaSignupError(null, 'leitura do número'))
  return ok({
    displayPhoneNumber: digits,
    verifiedName: res.body.verified_name ?? null,
  })
}
