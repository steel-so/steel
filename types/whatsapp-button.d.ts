import type {
  WhatsAppButtonAction,
  WhatsAppButtonActionKind,
} from '@/src/schemas/whatsapp-button.schema'

export type { WhatsAppButtonAction, WhatsAppButtonActionKind }

export type WhatsAppButtonDTO =
  | {
      id: string
      type: 'REPLY'
      label: string
      actions: WhatsAppButtonAction[]
    }
  | { id: string; type: 'URL'; label: string; url: string }

/** Buttons as sent on a message — no actions (never leaked to the thread). */
export type WhatsAppMessageButtonDTO =
  | { id: string; type: 'REPLY'; label: string }
  | { id: string; type: 'URL'; label: string; url: string }
