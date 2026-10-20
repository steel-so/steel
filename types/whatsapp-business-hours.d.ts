/** Horário de atendimento visto pelos atendentes (banner da conversa). */
export interface WhatsAppBusinessHoursStatusDTO {
  enabled: boolean
  start: string
  end: string
  /** 0 = domingo … 6 = sábado. */
  days: number[]
  /** Envios liberados agora. */
  open: boolean
  /** Próxima abertura quando fechado (nula se aberto ou sem dias). */
  nextOpeningAt: string | null
}
