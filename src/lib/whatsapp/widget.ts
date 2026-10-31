import { createHash, randomBytes } from 'node:crypto'

/**
 * Site chat widget (E1): pure helpers — keys, visitor tokens, allowed
 * origins and the snippet the customer pastes on the site.
 */

export const WIDGET_KEY_PREFIX = 'stw_'
export const WIDGET_SCRIPT_PATH = '/steel-widget.js'
/** Header that carries the visitor token on the public endpoints. */
export const WIDGET_TOKEN_HEADER = 'x-steel-widget-token'
export const WIDGET_MESSAGE_MAX = 2000
export const WIDGET_MAX_ORIGINS = 20
export const WIDGET_POLL_LIMIT = 100
/** The offline notice is not repeated inside this window per conversation. */
export const WIDGET_OFFLINE_NOTICE_HOURS = 12
/** The virtual connection every widget conversation hangs on. */
export const WIDGET_CONNECTION_LABEL = 'Chat do site'
export const WIDGET_CONNECTION_PHONE = 'widget'
/** Identity key of a visitor in `WhatsAppContact.waId`. */
export const WIDGET_WAID_PREFIX = 'widget:'

export function generateWidgetKey(): string {
  return `${WIDGET_KEY_PREFIX}${randomBytes(18).toString('base64url')}`
}

export function generateVisitorToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashVisitorToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function widgetWaId(visitorId: string): string {
  return `${WIDGET_WAID_PREFIX}${visitorId}`
}

export function isWidgetWaId(waId: string): boolean {
  return waId.startsWith(WIDGET_WAID_PREFIX)
}

const WILDCARD_HOST = /^\*\./

/**
 * Normalizes an allowed-origin entry or a request `Origin`: lower-case
 * `scheme://host[:port]`, no path. Accepts a `*.` wildcard in front of the
 * host. `null` for anything that is not an http(s) origin.
 */
export function normalizeOrigin(value: string): string | null {
  const match = value.trim().match(/^(https?):\/\/([^/?#]+)/i)
  if (!match) return null
  const scheme = match[1].toLowerCase()
  const authority = match[2].toLowerCase()
  const wildcard = WILDCARD_HOST.test(authority)
  const probe = wildcard ? authority.replace(WILDCARD_HOST, '') : authority
  let origin: URL
  try {
    origin = new URL(`${scheme}://${probe}`)
  } catch {
    return null
  }
  if (!origin.hostname || origin.username || origin.password) return null
  return wildcard
    ? `${scheme}://*.${origin.host}`
    : `${scheme}://${origin.host}`
}

/** Whether `origin` (a request `Origin`) is covered by the allowed list. */
export function isOriginAllowed(
  origin: string | null | undefined,
  allowed: readonly string[],
): boolean {
  if (!origin) return false
  const actual = normalizeOrigin(origin)
  if (!actual || actual.includes('*')) return false
  const actualUrl = new URL(actual)
  for (const entry of allowed) {
    const rule = normalizeOrigin(entry)
    if (!rule) continue
    if (rule === actual) return true
    if (!rule.includes('*.')) continue
    const ruleUrl = new URL(rule.replace('*.', ''))
    if (ruleUrl.protocol !== actualUrl.protocol) continue
    if (ruleUrl.port !== actualUrl.port) continue
    if (actualUrl.hostname.endsWith(`.${ruleUrl.hostname}`)) return true
  }
  return false
}

/** `<script>` snippet for the site. */
export function buildWidgetSnippet(baseUrl: string, publicKey: string): string {
  return `<script src="${baseUrl}${WIDGET_SCRIPT_PATH}" data-key="${publicKey}" async></script>`
}

export type WidgetSurveyKind = 'NPS' | 'CSAT' | 'CES'

const SURVEY_QUESTIONS: Record<WidgetSurveyKind, string> = {
  NPS: 'De 0 a 10, quanto você recomendaria o nosso atendimento a um amigo ou colega?',
  CSAT: 'De 1 a 5, como você avalia o atendimento que recebeu?',
  CES: 'De 1 a 7, o quanto foi fácil resolver o que você precisava?',
}

export function widgetSurveyQuestion(kind: WidgetSurveyKind): string {
  return SURVEY_QUESTIONS[kind]
}
