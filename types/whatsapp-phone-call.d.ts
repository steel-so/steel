export type WhatsAppPhoneCallStatusDTO =
  | 'QUEUED'
  | 'DIALING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'BUSY'
  | 'NO_ANSWER'
  | 'CANCELED'
  | 'EXTENSION_NO_ANSWER'
  | 'FAILED'

export interface WhatsAppPhoneCallDTO {
  id: string
  conversationId: string
  userId: string | null
  extension: string
  destination: string
  status: WhatsAppPhoneCallStatusDTO
  answeredAt: string | null
  endedAt: string | null
  durationSeconds: number | null
  createdAt: string
}
