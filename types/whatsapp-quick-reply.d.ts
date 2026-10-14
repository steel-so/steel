import type { WhatsAppButtonDTO } from './whatsapp-button'

export interface WhatsAppQuickReplyDTO {
  id: string
  workspaceId: string
  shortcut: string
  title: string
  body: string
  mediaUrl: string | null
  buttons: WhatsAppButtonDTO[]
  createdAt: string
  updatedAt: string
}
