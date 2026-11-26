import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import { BETTER_AUTH_SECRET, BETTER_AUTH_URL } from '@/lib/env/server'
import { isUrgentNotificationKind } from '@/src/lib/notification-kind'
import { sanitizeSdTemplateParam } from '@/src/lib/servicedesk/requester-whatsapp'
import { normalizeSdWhatsappNumber } from '@/src/lib/servicedesk/whatsapp'

/**
 * Pure rules of the "notices on WhatsApp" channel (no I/O): number
 * normalization, the verification code and the message text. The workspace's
 * own Comunicação connection sends them (see `NotificationWhatsappService`).
 */

/** The 6-digit code is valid for this long. */
export const WHATSAPP_CODE_TTL_MS = 10 * 60 * 1000
/** Wrong guesses before the code is burned and a new one is required. */
export const WHATSAPP_CODE_MAX_ATTEMPTS = 5
/** WhatsApp text accepts far more, but a notice is meant to be glanceable. */
export const WHATSAPP_NOTICE_MAX_LENGTH = 900

/** Digits with country code (BR default), or `null` when it is not a phone. */
export function normalizeNotificationNumber(
  raw: string | null | undefined,
): string | null {
  return normalizeSdWhatsappNumber(raw)
}

/** `+55 11 •••••-0000` — enough for the user to recognize their number. */
export function maskNotificationNumber(number: string): string {
  if (number.length < 8) return '••••'
  return `+${number.slice(0, 2)} ${number.slice(2, 4)} •••••-${number.slice(-4)}`
}

export function generateVerificationCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

function codeDigest(userId: string, number: string, code: string): Buffer {
  return createHmac('sha256', BETTER_AUTH_SECRET)
    .update(`${userId}:${number}:${code}`)
    .digest()
}

/** Stored instead of the code; bound to the user and the number. */
export function hashVerificationCode(
  userId: string,
  number: string,
  code: string,
): string {
  return codeDigest(userId, number, code).toString('hex')
}

export function verificationCodeMatches(
  userId: string,
  number: string,
  code: string,
  storedHash: string | null | undefined,
): boolean {
  if (!storedHash) return false
  const expected = Buffer.from(storedHash, 'hex')
  const actual = codeDigest(userId, number, code)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

/**
 * Should this kind reach the user's WhatsApp? An explicit choice wins; with
 * none, only the urgent kinds (SLA breached, approvals, assignments...).
 */
export function whatsappEnabledForKind(
  kind: string,
  saved: boolean | null | undefined,
): boolean {
  return saved ?? isUrgentNotificationKind(kind)
}

export function verificationMessage(code: string): string {
  return `*Steel* — seu código para ativar os avisos por WhatsApp é *${code}*. Ele vale por 10 minutos. Se não foi você, ignore esta mensagem.`
}

/** The notice as WhatsApp text: bold title, body and the app link. */
export function formatWhatsAppNotice(input: {
  title: string
  body: string
  /** Internal path (`/slug/crm/...`); made absolute with the app URL. */
  href?: string | null
  baseUrl?: string
}): string {
  const base = (input.baseUrl ?? BETTER_AUTH_URL).replace(/\/$/, '')
  const link = input.href
    ? /^https?:\/\//.test(input.href)
      ? input.href
      : `${base}${input.href}`
    : ''
  const title = `*${input.title.trim()}*`
  // Only the body is trimmed: the title and the link must survive.
  const room = Math.max(
    0,
    WHATSAPP_NOTICE_MAX_LENGTH - title.length - link.length - 2,
  )
  const raw = input.body.trim()
  const body =
    raw.length <= room ? raw : `${raw.slice(0, Math.max(0, room - 1))}…`
  return [title, body, link].filter(Boolean).join('\n')
}

/**
 * Fixed Meta template used when the 24 h window is closed. One per Meta
 * connection, created by the app itself (UTILITY) and approved by Meta.
 * Variables: {{1}} title, {{2}} message, {{3}} link.
 */
export const NOTICE_TEMPLATE = {
  name: 'steel_aviso',
  language: 'pt_BR',
  category: 'UTILITY',
} as const

const NOTICE_TEMPLATE_BODY =
  'Aviso do Steel: {{1}}\n\n{{2}}\n\nAbrir: {{3}}\n\nMensagem automática do Steel.'

/** `components` sent to Meta to create the template (with the examples). */
export function noticeTemplateComponents(): unknown[] {
  return [
    {
      type: 'BODY',
      text: NOTICE_TEMPLATE_BODY,
      example: {
        body_text: [
          [
            'Nova conversa',
            'Ana: preciso de ajuda com a minha fatura',
            'https://app.steel.so/acme/zap',
          ],
        ],
      },
    },
  ]
}

/** Absolute link of a notice, or the app root when it has none. */
export function noticeLink(href?: string | null, baseUrl?: string): string {
  const base = (baseUrl ?? BETTER_AUTH_URL).replace(/\/$/, '')
  if (!href) return base
  return /^https?:\/\//.test(href) ? href : `${base}${href}`
}

/** Body parameters of the template (Meta forbids newlines in a variable). */
export function noticeTemplateParams(input: {
  title: string
  body: string
  href?: string | null
  baseUrl?: string
}): unknown[] {
  return [
    {
      type: 'body',
      parameters: [
        input.title,
        input.body,
        noticeLink(input.href, input.baseUrl),
      ].map((text) => ({ type: 'text', text: sanitizeSdTemplateParam(text) })),
    },
  ]
}

export type NoticeRoute =
  | { route: 'text' }
  | { route: 'template' }
  | { route: 'skip'; reason: NoticeSkipReason }

export type NoticeSkipReason =
  | 'template_missing'
  | 'template_pending'
  | 'template_unavailable'

/**
 * How a notice reaches the number: Z-API always sends text; Meta sends text
 * inside the 24 h window and the approved template outside it.
 */
export function decideNoticeRoute(input: {
  provider: 'META' | 'ZAPI' | 'WIDGET'
  windowOpen: boolean
  /** Status of the notice template on the connection; `null` = not created. */
  templateStatus: string | null
}): NoticeRoute {
  if (input.provider !== 'META' || input.windowOpen) return { route: 'text' }
  if (input.templateStatus === 'APPROVED') return { route: 'template' }
  if (input.templateStatus === null) {
    return { route: 'skip', reason: 'template_missing' }
  }
  if (input.templateStatus === 'PENDING') {
    return { route: 'skip', reason: 'template_pending' }
  }
  return { route: 'skip', reason: 'template_unavailable' }
}
