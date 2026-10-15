import { z } from 'zod'
import { WhatsAppButtonSchema } from '@/src/schemas/whatsapp-button.schema'
import type {
  WhatsAppButtonDTO,
  WhatsAppMessageButtonDTO,
} from '@/types/whatsapp-button'

const StoredButtonsSchema = z.array(WhatsAppButtonSchema)

/** Buttons saved in a `Json` column; anything malformed reads as none. */
export function parseStoredButtons(value: unknown): WhatsAppButtonDTO[] {
  if (value == null) return []
  const parsed = StoredButtonsSchema.safeParse(value)
  return parsed.success ? parsed.data : []
}

/** Template synced from Meta without stored buttons: derive them from the
 * BUTTONS component (QUICK_REPLY → REPLY, URL → URL; others are skipped).
 * Ids are positional (`b1`, `b2`…) — the same ids the sender uses as payload. */
export function deriveTemplateButtons(
  components: unknown,
): WhatsAppButtonDTO[] {
  if (!Array.isArray(components)) return []
  const block = components.find(
    (c): c is { type: 'BUTTONS'; buttons: unknown[] } =>
      typeof c === 'object' &&
      c !== null &&
      (c as { type?: unknown }).type === 'BUTTONS' &&
      Array.isArray((c as { buttons?: unknown }).buttons),
  )
  if (!block) return []
  const result: WhatsAppButtonDTO[] = []
  block.buttons.forEach((raw, index) => {
    const button = raw as { type?: string; text?: string; url?: string }
    const id = `b${index + 1}`
    if (button.type === 'QUICK_REPLY' && button.text) {
      result.push({ id, type: 'REPLY', label: button.text, actions: [] })
    } else if (button.type === 'URL' && button.text && button.url) {
      result.push({ id, type: 'URL', label: button.text, url: button.url })
    }
  })
  return result
}

/** What goes on a message row/DTO: the buttons without their actions. */
export function toMessageButtons(
  buttons: WhatsAppButtonDTO[],
): WhatsAppMessageButtonDTO[] {
  return buttons.map((button) =>
    button.type === 'URL'
      ? { id: button.id, type: 'URL', label: button.label, url: button.url }
      : { id: button.id, type: 'REPLY', label: button.label },
  )
}

const MessageButtonsSchema = z.array(
  z.discriminatedUnion('type', [
    z.object({ id: z.string(), type: z.literal('REPLY'), label: z.string() }),
    z.object({
      id: z.string(),
      type: z.literal('URL'),
      label: z.string(),
      url: z.string(),
    }),
  ]),
)

export function parseMessageButtons(
  value: unknown,
): WhatsAppMessageButtonDTO[] | null {
  if (value == null) return null
  const parsed = MessageButtonsSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
