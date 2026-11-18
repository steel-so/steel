/**
 * Rows of the Comunicação (WhatsApp) dashboard sources
 * (`GET /api/workspaces/[id]/whatsapp/dashboards/sources/[source]`).
 * Labels come in pt-BR (the widget engine groups/filters by text). No row
 * carries the contact's name or phone, so the sources are safe for a TV.
 */

/** One row per recipient of an AI campaign. */
export interface WaAiCampaignRecipientDashboardRow {
  id: string
  /** Campaign name (the bank/group of the send). */
  campaign: string
  /** Rascunho, Enviando, Pausada, Concluída, Arquivada. */
  campaignStatus: string
  /** Enviado, Falhou, Pendente, Ignorado. */
  sendStatus: string
  /** The template left Steel (recipient `SENT`). */
  isSent: boolean
  /** Lida, Entregue, Enviada, Não entregue; `null` when it was not sent. */
  delivery: string | null
  /** The provider confirmed the delivery (delivered or read). */
  isDelivered: boolean
  /**
   * What the contact answered after the send: `Sim`, `Não`, the text of
   * another button, `Outra resposta` (free text/media) or `Sem retorno`.
   * `null` when the template was not sent.
   */
  response: string | null
  replied: boolean
  /** The conversation went to a human attendant. */
  transferred: boolean
  /**
   * Sem retorno, Aguardando atendimento (answered, open, no human message
   * yet), Em atendimento, Encerrada. `null` when it was not sent.
   */
  stage: string | null
  isWaiting: boolean
  attendant: string | null
  team: string | null
  /** Deu certo, Não deu; `null` without a close classification. */
  outcome: string | null
  /** Close statuses picked by the attendant (tabulação). */
  closeStatus: string[]
  sentAt: string | null
  repliedAt: string | null
  closedAt: string | null
  createdAt: string
}

export type WaDashboardRow =
  | WaAiCampaignRecipientDashboardRow
  | import('./whatsapp-dashboard-channels').WaChannelDashboardRow
