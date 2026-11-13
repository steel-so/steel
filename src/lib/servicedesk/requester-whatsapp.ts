import type { WhatsAppProvider } from '@prisma/client'
import { sdNotificationEvent } from '@/src/config/servicedesk-notifications'
import { SD_WHATSAPP_WINDOW_HOURS } from '@/src/lib/servicedesk/whatsapp'

/**
 * Rules (no I/O) for notifying the REQUESTER of a ticket on WhatsApp by an
 * approved Meta template, configured per catalog event in
 * `SdSettings.requesterWhatsappTemplates`.
 */

/** Values a template body variable ({{1}}, {{2}}...) can be filled with. */
export const SD_REQUESTER_TEMPLATE_VARIABLES = [
  'code',
  'title',
  'headline',
  'message',
  'requester',
] as const

export type SdRequesterTemplateVariable =
  (typeof SD_REQUESTER_TEMPLATE_VARIABLES)[number]

export interface SdRequesterTemplateConfig {
  templateName: string
  language: string
  /** Body variables in order: the first fills {{1}}, and so on. */
  variables: SdRequesterTemplateVariable[]
}

export type SdRequesterTemplates = Record<string, SdRequesterTemplateConfig>

/** Max length of one body parameter (Meta rejects very long values). */
const PARAM_MAX = 1000

/** The event is open to the customer (the requester or the external contact). */
export function isSdRequesterEvent(event: string): boolean {
  const spec = sdNotificationEvent(event)
  return (
    !!spec &&
    !spec.agentOnly &&
    (spec.audience.includes('requester') || spec.audience.includes('contact'))
  )
}

function isVariable(value: unknown): value is SdRequesterTemplateVariable {
  return (SD_REQUESTER_TEMPLATE_VARIABLES as readonly unknown[]).includes(value)
}

/**
 * Template config saved in the settings JSON. Anything malformed (or for an
 * event that is not customer-facing) is dropped, never thrown.
 */
export function parseSdRequesterTemplates(
  value: unknown,
): SdRequesterTemplates {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: SdRequesterTemplates = {}
  for (const [event, raw] of Object.entries(value)) {
    if (!isSdRequesterEvent(event)) continue
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    if (typeof row.templateName !== 'string' || !row.templateName) continue
    if (typeof row.language !== 'string' || !row.language) continue
    const variables = Array.isArray(row.variables)
      ? row.variables.filter(isVariable)
      : []
    out[event] = {
      templateName: row.templateName,
      language: row.language,
      variables,
    }
  }
  return out
}

/** Meta forbids newlines, tabs and runs of spaces inside a body parameter. */
export function sanitizeSdTemplateParam(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  const value =
    clean.length > PARAM_MAX ? `${clean.slice(0, PARAM_MAX - 1)}…` : clean
  return value || '-'
}

export interface SdRequesterTemplateValues {
  code: string
  title: string
  headline: string
  message: string
  requester: string
}

/** Meta `components` array: a single `body` with the ordered parameters. */
export function buildSdRequesterComponents(
  config: SdRequesterTemplateConfig,
  values: SdRequesterTemplateValues,
): unknown[] {
  if (config.variables.length === 0) return []
  return [
    {
      type: 'body',
      parameters: config.variables.map((variable) => ({
        type: 'text',
        text: sanitizeSdTemplateParam(values[variable]),
      })),
    },
  ]
}

export type SdRequesterSendDecision =
  | { action: 'template' }
  | { action: 'text' }
  | {
      action: 'skip'
      reason:
        | 'opted_out'
        | 'template_unavailable'
        | 'window_closed'
        | 'no_channel'
    }

export interface SdRequesterDecisionInput {
  provider: WhatsAppProvider
  /** The contact asked to stop receiving messages (LGPD). */
  optedOut: boolean
  /** A template is configured for the event. */
  templateConfigured: boolean
  /** That template exists and is APPROVED on the connection. */
  templateApproved: boolean
  /**
   * Free text is allowed as the channel: the platform requester turned
   * WhatsApp on in the preferences, or the catalog enables it by default.
   */
  textAllowed: boolean
  lastInboundAt: Date | null
  now?: Date
}

/** The Meta customer-service window: free text only within 24 h of the last inbound. */
export function sdRequesterWindowOpen(
  lastInboundAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (!lastInboundAt) return false
  return (
    lastInboundAt.getTime() + SD_WHATSAPP_WINDOW_HOURS * 3_600_000 >
    now.getTime()
  )
}

/**
 * Template when configured and approved (Meta); otherwise free text, only if
 * it is allowed as the channel and the 24 h window is open (Z-API has no
 * window and no templates). Opt-out always wins.
 */
export function decideSdRequesterSend(
  input: SdRequesterDecisionInput,
): SdRequesterSendDecision {
  if (input.optedOut) return { action: 'skip', reason: 'opted_out' }
  if (input.provider === 'ZAPI') {
    // No templates on Z-API: a configured event just means "tell the customer".
    return input.textAllowed || input.templateConfigured
      ? { action: 'text' }
      : { action: 'skip', reason: 'no_channel' }
  }
  if (input.templateConfigured) {
    if (input.templateApproved) return { action: 'template' }
    if (!input.textAllowed) {
      return { action: 'skip', reason: 'template_unavailable' }
    }
  } else if (!input.textAllowed) {
    return { action: 'skip', reason: 'no_channel' }
  }
  return sdRequesterWindowOpen(input.lastInboundAt, input.now)
    ? { action: 'text' }
    : {
        action: 'skip',
        reason: input.templateConfigured
          ? 'template_unavailable'
          : 'window_closed',
      }
}
