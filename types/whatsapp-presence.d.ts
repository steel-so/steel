export type WhatsAppPresenceStatusDTO = 'AVAILABLE' | 'AWAY'

export interface WhatsAppPresenceDTO {
  userId: string
  status: WhatsAppPresenceStatusDTO
  /** Null while the person never changed it (counts as AVAILABLE). */
  updatedAt: string | null
}
