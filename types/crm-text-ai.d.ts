/** Resposta do mini chat de IA de um campo de texto do CRM. */
export interface CrmTextAiReplyDTO {
  reply: string
  /** Texto pronto para aplicar no campo, ou `null` quando a IA só conversou. */
  suggestion: string | null
}
