export type WhatsAppCloseOutcomeDTO = 'SUCCESS' | 'FAILURE'

export interface WhatsAppCloseStatusDTO {
  id: string
  label: string
  outcome: WhatsAppCloseOutcomeDTO
  position: number
}

/** Opções do fechamento + quantas o atendente escolhe. */
export interface WhatsAppCloseStatusOptionsDTO {
  statuses: WhatsAppCloseStatusDTO[]
  /** 0 = classificação opcional. Ignorado sem status cadastrados. */
  minSelections: number
  maxSelections: number
}
