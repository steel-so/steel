/**
 * Rows of the messaging sources of the Comunicação (WhatsApp) dashboards:
 * messages, broadcast recipients, templates, message costs and AI campaign
 * actions. Same contract as `types/whatsapp-dashboard.d.ts`: flattened rows
 * with pt-BR labels, and no row carries the contact's name, phone or the
 * text of a message.
 */

/** One row per message of a one-to-one conversation. */
export interface WaMessageDashboardRow {
  id: string
  /** Recebida, Enviada. */
  direction: string
  /**
   * Texto, Imagem, Áudio, Vídeo, Documento, Figurinha, Localização, Modelo,
   * Botão, Contato.
   */
  type: string
  /**
   * Pendente, Enviada, Entregue, Lida, Falhou for a sent message; `Recebida`
   * for a message of the contact (it has no delivery cycle).
   */
  status: string
  /** Contato, IA, Atendente, Sistema (broadcast, chatbot, automation…). */
  author: string
  /** Who wrote it; `null` unless the author is an attendant. */
  attendant: string | null
  isFailed: boolean
  /** Provider reason of the failure ("code: text"). */
  failureReason: string | null
  /** 0/100 for a sent message (the average is the rate); `null` if received. */
  deliveredPct: number | null
  readPct: number | null
  failedPct: number | null
  /** Positivo, Neutro, Negativo; `null` until the message is classified. */
  sentiment: string | null
  /** -1 (negative) to 1 (positive). */
  sentimentScore: number | null
  /** Label of the WhatsApp number. */
  connection: string
  /** Meta (API oficial), Z-API, Widget do site. */
  provider: string
  team: string | null
  /** AI campaign of the conversation. */
  aiCampaign: string | null
  createdAt: string
}

/** One row per recipient of a broadcast list. */
export interface WaBroadcastRecipientDashboardRow {
  id: string
  /** Name of the broadcast list. */
  broadcast: string
  /** Rascunho, Agendada, Enviando, Concluída, Falhou. */
  broadcastStatus: string
  /** Pendente, Enviado, Falhou, Ignorado, Sem WhatsApp. */
  status: string
  isSent: boolean
  isFailed: boolean
  /** Why it failed or was skipped. */
  error: string | null
  /** Template of the list; `null` for a plain-text broadcast. */
  template: string | null
  connection: string
  /** Sent through Marketing Messages Lite. */
  viaMarketingLite: boolean
  /** Lida, Entregue, Enviada, Não entregue; `null` when it was not sent. */
  delivery: string | null
  /** The provider confirmed the delivery (delivered or read). */
  isDelivered: boolean
  scheduledAt: string | null
  sentAt: string | null
  createdAt: string
}

/** One row per message template (current state). */
export interface WaTemplateDashboardRow {
  id: string
  name: string
  language: string
  /** Marketing, Utilidade, Autenticação (or Meta's value, when new). */
  category: string
  /** Aprovado, Em análise, Rejeitado, Pausado, Desativado. */
  status: string
  /** Alta, Média, Baixa, Sem avaliação. */
  quality: string
  connection: string
  /** Texto, Imagem, Vídeo, Documento; `null` without a header. */
  header: string | null
  hasButtons: boolean
  buttonCount: number
  createdAt: string
  updatedAt: string
}

/** One row per entry of the message cost ledger (ADR 0050 and 0064). */
export interface WaCostDashboardRow {
  id: string
  /** Marketing, Utilidade, Autenticação, Atendimento (janela de 24 h). */
  category: string
  /** Modelo (paid template) or Atendimento (free-form, 24 h window). */
  kind: string
  /**
   * Transmissões, Campanhas de IA, Campanhas do CRM, Atendentes, Respostas
   * da IA, Botões, Outros.
   */
  origin: string
  /** Estimated cost of the entry; 0 once the provider reported a failure. */
  amount: number
  unitPrice: number
  quantity: number
  /** ISO 4217 code of `amount` (BRL unless the price table says otherwise). */
  currency: string
  connection: string
  provider: string
  viaMarketingLite: boolean
  /** The message failed afterwards and the cost was zeroed. */
  isReversed: boolean
  /** Name of the broadcast list or AI campaign that sent it, when any. */
  broadcast: string | null
  aiCampaign: string | null
  occurredAt: string
}

/** One row per action the AI ran in an AI campaign conversation. */
export interface WaAiCampaignActionDashboardRow {
  id: string
  campaign: string
  /** Transferir para um atendente, Fechar a conversa, Chamar webhook… */
  actionType: string
  /** Name the admin gave to the action. */
  action: string
  /** Sucesso, Falhou. */
  status: string
  isSuccess: boolean
  error: string | null
  createdAt: string
}
