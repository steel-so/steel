export type WhatsAppCopilotToneDTO =
  | 'FRIENDLY'
  | 'FORMAL'
  | 'DIRECT'
  | 'EMPATHETIC'
  | 'FIX_ONLY'

export interface WhatsAppCopilotSuggestionDTO {
  /** Reply ready to drop in the composer. */
  text: string
}

export interface WhatsAppCopilotSummaryDTO {
  summary: string
  /** What is still open or was promised to the customer. */
  pending: string[]
}

export interface WhatsAppCopilotRewriteDTO {
  text: string
}
