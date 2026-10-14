/**
 * Click payload of a reply button: `stl:<t|q>:<sourceId>:<buttonId>` — `t` =
 * Meta template id, `q` = quick reply id. It travels with the button (Meta
 * template `payload`, interactive `reply.id`, Z-API button `id`) and comes
 * back on the click, so the click finds the actions configured for it.
 */
export type WhatsAppButtonSourceType = 'TEMPLATE' | 'QUICK_REPLY'

export interface WhatsAppButtonPayload {
  sourceType: WhatsAppButtonSourceType
  sourceId: string
  buttonId: string
}

const PREFIX = 'stl'
const CODE_BY_SOURCE: Record<WhatsAppButtonSourceType, string> = {
  TEMPLATE: 't',
  QUICK_REPLY: 'q',
}
const SOURCE_BY_CODE: Record<string, WhatsAppButtonSourceType> = {
  t: 'TEMPLATE',
  q: 'QUICK_REPLY',
}

/** Meta caps the payload/reply id at 256 characters. */
export const WHATSAPP_BUTTON_PAYLOAD_MAX = 256

export function buildButtonPayload(input: WhatsAppButtonPayload): string {
  return [
    PREFIX,
    CODE_BY_SOURCE[input.sourceType],
    input.sourceId,
    input.buttonId,
  ].join(':')
}

/** `null` for anything that is not one of our payloads (foreign buttons). */
export function parseButtonPayload(
  raw: string | null | undefined,
): WhatsAppButtonPayload | null {
  if (!raw || raw.length > WHATSAPP_BUTTON_PAYLOAD_MAX) return null
  const parts = raw.split(':')
  if (parts.length !== 4 || parts[0] !== PREFIX) return null
  const sourceType = SOURCE_BY_CODE[parts[1]]
  const [, , sourceId, buttonId] = parts
  if (!sourceType || !sourceId || !buttonId) return null
  return { sourceType, sourceId, buttonId }
}
