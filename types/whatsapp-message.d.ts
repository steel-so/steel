import type { WhatsAppMessageButtonDTO } from './whatsapp-button'
export type WhatsAppMessageDirectionDTO = 'IN' | 'OUT'

export type WhatsAppMessageTypeDTO =
  | 'TEXT'
  | 'IMAGE'
  | 'AUDIO'
  | 'VIDEO'
  | 'DOCUMENT'
  | 'STICKER'
  | 'LOCATION'
  | 'TEMPLATE'
  | 'BUTTON'
  | 'CONTACT'

export type WhatsAppMessageStatusDTO =
  | 'PENDING'
  | 'SENT'
  | 'DELIVERED'
  | 'READ'
  | 'FAILED'

export interface WhatsAppMessageContactPayload {
  name: string
  waId: string
}

export interface WhatsAppMessageDTO {
  id: string
  workspaceId: string
  conversationId: string
  direction: WhatsAppMessageDirectionDTO
  type: WhatsAppMessageTypeDTO
  text: string | null
  mediaUrl: string | null
  status: WhatsAppMessageStatusDTO
  senderUserId: string | null
  sentByAi: boolean
  replyToMessageId: string | null
  reactionEmoji: string | null
  reactedByContact: boolean | null
  contactPayload: WhatsAppMessageContactPayload | null
  /** Buttons sent with an OUT message (rendered under the bubble). */
  buttons: WhatsAppMessageButtonDTO[] | null
  /** IN click: the clicked button id (or the provider's raw payload). */
  buttonPayload: string | null
  createdAt: string
}
