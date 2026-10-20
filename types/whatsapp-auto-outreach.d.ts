export type WhatsAppAutoOutreachStatusDTO = 'IDLE' | 'RUNNING' | 'PAUSED' | 'DONE'

/** Disparo automático de template pela IA (um por workspace). */
export interface WhatsAppAutoOutreachDTO {
  status: WhatsAppAutoOutreachStatusDTO
  connectionId: string | null
  templateId: string | null
  /** Contagem da fila por situação. */
  pending: number
  sent: number
  failed: number
  skipped: number
  lastSentAt: string | null
  /** Motivo da última pausa automática. */
  lastError: string | null
}
