import type { WhatsAppTemplate } from '@prisma/client'
import type { WhatsAppMessageButtonDTO } from '@/types/whatsapp-button'
import { buildButtonPayload } from './button-payload'
import {
  deriveTemplateButtons,
  parseStoredButtons,
  toMessageButtons,
} from './buttons'

type TemplateForSend = Pick<
  WhatsAppTemplate,
  'id' | 'components' | 'buttons' | 'headerFormat' | 'headerMediaUrl'
>

interface RawComponent {
  type?: string
  format?: string
  example?: { header_handle?: unknown[] }
  buttons?: { type?: string; text?: string }[]
}

interface SendComponent {
  type?: string
  sub_type?: string
  index?: string
}

const MEDIA_FORMATS = new Set(['IMAGE', 'VIDEO', 'DOCUMENT'])

function rawComponents(template: TemplateForSend): RawComponent[] {
  return Array.isArray(template.components)
    ? (template.components as RawComponent[])
    : []
}

/** The template's buttons: stored (with our ids) or derived from Meta's. */
export function templateButtons(template: TemplateForSend) {
  const stored = parseStoredButtons(template.buttons)
  return stored.length > 0 ? stored : deriveTemplateButtons(template.components)
}

/**
 * Media URL to send as the header parameter: our MinIO copy, else the sample
 * Meta keeps for templates synced from it (`example.header_handle[0]`).
 */
export function templateHeaderMedia(
  template: TemplateForSend,
): { format: 'IMAGE' | 'VIDEO' | 'DOCUMENT'; url: string } | null {
  const header = rawComponents(template).find((c) => c?.type === 'HEADER')
  const format = template.headerFormat ?? header?.format
  if (!format || !MEDIA_FORMATS.has(format)) return null
  const sample = header?.example?.header_handle?.[0]
  const url =
    template.headerMediaUrl ??
    (typeof sample === 'string' && sample.startsWith('https://')
      ? sample
      : null)
  if (!url) return null
  return { format: format as 'IMAGE' | 'VIDEO' | 'DOCUMENT', url }
}

/** Position of a reply button inside Meta's BUTTONS block (the send index). */
function metaButtonIndex(
  template: TemplateForSend,
  label: string,
  fallback: number,
): number {
  const block = rawComponents(template).find((c) => c?.type === 'BUTTONS')
  const index =
    block?.buttons?.findIndex(
      (b) => b?.type === 'QUICK_REPLY' && b.text === label,
    ) ?? -1
  return index >= 0 ? index : fallback
}

/**
 * Completes the `components` of a template send with what the agent never
 * fills by hand: the media header parameter (every send of a media-header
 * template needs it) and the click payload of each reply button
 * (`stl:t:<templateId>:<buttonId>`). Components already present (built by
 * the caller) win. Also returns the buttons to store on the message.
 */
export function applyTemplateSendExtras(
  template: TemplateForSend,
  components: unknown[] | undefined,
): { components: unknown[]; buttons: WhatsAppMessageButtonDTO[] } {
  const result = [...(components ?? [])]
  const present = result as SendComponent[]

  const media = templateHeaderMedia(template)
  if (media && !present.some((c) => c?.type === 'header')) {
    const kind = media.format.toLowerCase()
    result.unshift({
      type: 'header',
      parameters: [{ type: kind, [kind]: { link: media.url } }],
    })
  }

  const buttons = templateButtons(template)
  buttons.forEach((button, position) => {
    if (button.type !== 'REPLY') return
    const index = String(metaButtonIndex(template, button.label, position))
    const taken = present.some((c) => c?.type === 'button' && c.index === index)
    if (taken) return
    result.push({
      type: 'button',
      sub_type: 'quick_reply',
      index,
      parameters: [
        {
          type: 'payload',
          payload: buildButtonPayload({
            sourceType: 'TEMPLATE',
            sourceId: template.id,
            buttonId: button.id,
          }),
        },
      ],
    })
  })

  return { components: result, buttons: toMessageButtons(buttons) }
}
