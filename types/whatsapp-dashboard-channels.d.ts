/**
 * Rows of the channel sources of the Comunicação (WhatsApp) dashboards:
 * calls, charges, appointments, chatbot, flows, ads and the contact base.
 * Same rules as `types/whatsapp-dashboard.d.ts`: pt-BR labels, flat fields,
 * no contact name, phone or document. `*Pct` fields are 0 or 100 (or `null`
 * when they do not apply), so their **average** is the rate.
 */

/** One row per phone call (click-to-call or browser phone). */
export interface WaCallDashboardRow {
  id: string
  /** Realizada, Recebida. */
  direction: string
  /** Clique para ligar, Telefone no navegador. */
  origin: string
  /**
   * Chamando o ramal, Chamando o contato, Em ligação, Atendida, Ocupado,
   * Não atendeu, Cancelada, Ramal não atendeu, Falhou.
   */
  status: string
  /** The other side picked up (the call has an answer time). */
  isAnswered: boolean
  /** 100 = answered, 0 = not; `null` while the call is still in progress. */
  answeredPct: number | null
  /** Talk time; `null` when the call was not answered or has not ended. */
  durationSeconds: number | null
  durationMinutes: number | null
  /** Seconds between placing the call and the answer. */
  ringSeconds: number | null
  attendant: string | null
  /** Team and number of the linked conversation, when there is one. */
  team: string | null
  connection: string | null
  hasRecording: boolean
  /** The IVR voice attendant (AI) answered the call. */
  isVoiceAgent: boolean
  /** Positivo, Neutro, Negativo; `null` without a processed recording. */
  sentiment: string | null
  createdAt: string
  answeredAt: string | null
  endedAt: string | null
}

/** One row per Pix or boleto charge sent in a conversation. */
export interface WaChargeDashboardRow {
  id: string
  /** Pix, Boleto. */
  method: string
  /** Aguardando pagamento, Pago, Vencido, Cancelado, Estornado. */
  status: string
  isPaid: boolean
  /** 100 = paid, 0 = expired/canceled/refunded; `null` while pending. */
  paidPct: number | null
  /** Charged amount in BRL. */
  amount: number
  /** Amount the PSP confirmed; `null` while it is not paid. */
  paidAmount: number | null
  /** Who created the charge (`IA` when the AI did). */
  attendant: string | null
  createdByAi: boolean
  minutesToPay: number | null
  createdAt: string
  paidAt: string | null
  /** Pix deadline or boleto due date. */
  expiresAt: string
}

/** One row per appointment of the native scheduling. */
export interface WaAppointmentDashboardRow {
  id: string
  service: string
  professional: string
  /** Aguardando confirmação, Confirmado, Cancelado, Concluído, Faltou. */
  status: string
  /** Atendente, Formulário (Flow), Contato. */
  origin: string
  durationMinutes: number
  /** Still to happen: pending or confirmed with a start in the future. */
  isUpcoming: boolean
  isCanceled: boolean
  /** 100 = missed, 0 = attended; `null` for any other status. */
  noShowPct: number | null
  /** Hours between the booking and the start. */
  leadHours: number
  startsAt: string
  createdAt: string
  canceledAt: string | null
}

/** One row per run of a chatbot over a conversation. */
export interface WaChatbotSessionDashboardRow {
  id: string
  chatbot: string
  /**
   * Em andamento, Passou para atendente, Passou para a IA, Concluído,
   * Expirou, Cancelado, Falhou.
   */
  status: string
  isRunning: boolean
  /** The flow reached its end without a person or the AI. */
  isFinished: boolean
  /** Handed off to a person or to the AI. */
  isHandoff: boolean
  /** 100 = the bot solved it alone, 0 = it did not; `null` while running. */
  finishedPct: number | null
  /** Why the session ended, in words; `null` while it runs. */
  endReason: string | null
  /** From the start to the end (or to the last activity while running). */
  durationMinutes: number
  team: string | null
  connection: string | null
  startedAt: string
  endedAt: string | null
}

/** One row per send of a WhatsApp Flow (form) to a contact. */
export interface WaFlowResponseDashboardRow {
  id: string
  flow: string
  /** Cadastro, Agendamento, Pesquisa, Outro... */
  category: string
  /** Aguardando resposta, Respondido. */
  status: string
  isCompleted: boolean
  /** 100 = answered, 0 = not yet. */
  completedPct: number
  /** Lead, Pessoa, Empresa; `null` when the answer created no CRM record. */
  crmRecord: string | null
  attendant: string | null
  minutesToRespond: number | null
  createdAt: string
  respondedAt: string | null
}

/** One row per conversation message that arrived from an ad or post. */
export interface WaAdReferralDashboardRow {
  id: string
  /** Anúncio, Publicação, Outro. */
  sourceType: string
  /** Meta ad (or post) id. */
  adId: string
  headline: string | null
  /** Headline of the ad, or its id when Meta sent none. */
  ad: string
  /** Imagem, Vídeo, Outro; `null` when Meta sent no media. */
  mediaType: string | null
  connection: string | null
  team: string | null
  /** The referral opened (or matched) a CRM lead. */
  generatedLead: boolean
  createdAt: string
}

/** One row per ad spend typed by an admin (an amount over a period). */
export interface WaAdSpendDashboardRow {
  id: string
  adId: string
  /** Label given to the spend, or the ad id without one. */
  ad: string
  /** Amount of the whole period in BRL. */
  amount: number
  periodDays: number
  dailyAmount: number
  periodStart: string
  periodEnd: string
  createdAt: string
}

/** One row per contact of the base. No name, phone or username. */
export interface WaContactDashboardRow {
  id: string
  /** Sim, Não, Não verificado. */
  hasWhatsapp: string
  /** Asked to stop receiving broadcasts (LGPD). */
  isOptedOut: boolean
  /** Palavra-chave, Administrador, IA; `null` when not opted out. */
  optOutSource: string | null
  /** Blocked on at least one number of the workspace. */
  isBlocked: boolean
  hasCrmPerson: boolean
  createdAt: string
  optedOutAt: string | null
}

export type WaChannelDashboardRow =
  | WaCallDashboardRow
  | WaChargeDashboardRow
  | WaAppointmentDashboardRow
  | WaChatbotSessionDashboardRow
  | WaFlowResponseDashboardRow
  | WaAdReferralDashboardRow
  | WaAdSpendDashboardRow
  | WaContactDashboardRow
