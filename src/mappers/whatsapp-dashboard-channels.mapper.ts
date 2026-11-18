import type {
  WhatsAppBoletoChargeStatus,
  WhatsAppChatbotSessionStatus,
  WhatsAppFlowResponseStatus,
  WhatsAppOptOutSource,
  WhatsAppPhoneCallDirection,
  WhatsAppPhoneCallSource,
  WhatsAppPhoneCallStatus,
  WhatsAppSchedAppointmentSource,
  WhatsAppSchedAppointmentStatus,
  WhatsAppSentiment,
} from '@prisma/client'
import { END_REASON_LABEL } from '@/src/lib/whatsapp/chatbot/editor-model'
import type {
  WaAdReferralData,
  WaChargeData,
  WaDashboardAdSpend,
  WaDashboardAppointment,
  WaDashboardBoletoCharge,
  WaDashboardCall,
  WaDashboardChatbotSession,
  WaDashboardContact,
  WaDashboardPixCharge,
  WaDashboardUserName,
  WaFlowResponseData,
} from '@/src/repositories/whatsapp-dashboard-channels.repository'
import type {
  WaAdReferralDashboardRow,
  WaAdSpendDashboardRow,
  WaAppointmentDashboardRow,
  WaCallDashboardRow,
  WaChargeDashboardRow,
  WaChatbotSessionDashboardRow,
  WaContactDashboardRow,
  WaFlowResponseDashboardRow,
} from '@/types/whatsapp-dashboard-channels'

const SECOND_MS = 1_000
const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** Elapsed time from `from` to `to` in `unit`s, never negative. */
function elapsed(from: Date, to: Date, unit: number, digits: number): number {
  return Math.max(0, round((to.getTime() - from.getTime()) / unit, digits))
}

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null
}

function namesById(users: WaDashboardUserName[]): Map<string, string> {
  return new Map(users.map((user) => [user.id, user.name]))
}

/* ---------------------------------- calls ---------------------------------- */

export const WA_CALL_DIRECTION_LABELS: Record<
  WhatsAppPhoneCallDirection,
  string
> = {
  OUTBOUND: 'Realizada',
  INBOUND: 'Recebida',
}

export const WA_CALL_SOURCE_LABELS: Record<WhatsAppPhoneCallSource, string> = {
  CLICK_TO_CALL: 'Clique para ligar',
  WEBPHONE: 'Telefone no navegador',
}

export const WA_CALL_STATUS_LABELS: Record<WhatsAppPhoneCallStatus, string> = {
  QUEUED: 'Chamando o ramal',
  DIALING: 'Chamando o contato',
  IN_PROGRESS: 'Em ligação',
  COMPLETED: 'Atendida',
  BUSY: 'Ocupado',
  NO_ANSWER: 'Não atendeu',
  CANCELED: 'Cancelada',
  EXTENSION_NO_ANSWER: 'Ramal não atendeu',
  FAILED: 'Falhou',
}

export const WA_SENTIMENT_LABELS: Record<WhatsAppSentiment, string> = {
  POSITIVE: 'Positivo',
  NEUTRAL: 'Neutro',
  NEGATIVE: 'Negativo',
}

/** One row per phone call, in the order the repository answered. */
export function toWaCallRows(calls: WaDashboardCall[]): WaCallDashboardRow[] {
  return calls.map((call) => {
    const isAnswered = call.answeredAt !== null
    // Still ringing: neither answered nor lost yet.
    const ringing = call.status === 'QUEUED' || call.status === 'DIALING'
    return {
      id: call.id,
      direction: WA_CALL_DIRECTION_LABELS[call.direction],
      origin: WA_CALL_SOURCE_LABELS[call.source],
      status: WA_CALL_STATUS_LABELS[call.status],
      isAnswered,
      answeredPct: isAnswered ? 100 : ringing ? null : 0,
      durationSeconds: call.durationSeconds,
      durationMinutes:
        call.durationSeconds === null
          ? null
          : round(call.durationSeconds / 60, 2),
      ringSeconds: call.answeredAt
        ? elapsed(call.createdAt, call.answeredAt, SECOND_MS, 0)
        : null,
      attendant: call.user?.name ?? null,
      team: call.conversation?.team?.name ?? null,
      connection: call.conversation?.connection.label ?? null,
      hasRecording: call.recordingKey !== null,
      isVoiceAgent: call.voiceAgent,
      sentiment: call.sentiment ? WA_SENTIMENT_LABELS[call.sentiment] : null,
      createdAt: call.createdAt.toISOString(),
      answeredAt: iso(call.answeredAt),
      endedAt: iso(call.endedAt),
    }
  })
}

/* --------------------------------- charges --------------------------------- */

/**
 * One wording for both methods (the Pix card says "Vencida", the boleto card
 * "Vencido"), so a widget grouped by status adds Pix and boleto together.
 */
export const WA_CHARGE_STATUS_LABELS: Record<
  WhatsAppBoletoChargeStatus,
  string
> = {
  PENDING: 'Aguardando pagamento',
  PAID: 'Pago',
  EXPIRED: 'Vencido',
  CANCELED: 'Cancelado',
  REFUNDED: 'Estornado',
}

export const WA_CHARGE_AI_ATTENDANT = 'IA'

interface ChargeInput {
  id: string
  method: string
  status: WhatsAppBoletoChargeStatus
  amount: WaDashboardPixCharge['amount']
  paidAmount: WaDashboardPixCharge['paidAmount']
  createdById: string | null
  createdByAi: boolean
  deadline: Date
  paidAt: Date | null
  createdAt: Date
}

function toChargeRow(
  charge: ChargeInput,
  names: Map<string, string>,
  now: Date,
): WaChargeDashboardRow {
  // A pending charge past its deadline reads as expired (same rule as the
  // Pix and boleto mappers).
  const status =
    charge.status === 'PENDING' && charge.deadline.getTime() <= now.getTime()
      ? 'EXPIRED'
      : charge.status
  const isPaid = status === 'PAID'
  const creator = charge.createdById
    ? (names.get(charge.createdById) ?? null)
    : null
  return {
    id: charge.id,
    method: charge.method,
    status: WA_CHARGE_STATUS_LABELS[status],
    isPaid,
    paidPct: status === 'PENDING' ? null : isPaid ? 100 : 0,
    amount: charge.amount.toNumber(),
    paidAmount: charge.paidAmount ? charge.paidAmount.toNumber() : null,
    attendant: charge.createdByAi ? WA_CHARGE_AI_ATTENDANT : creator,
    createdByAi: charge.createdByAi,
    minutesToPay: charge.paidAt
      ? elapsed(charge.createdAt, charge.paidAt, MINUTE_MS, 1)
      : null,
    createdAt: charge.createdAt.toISOString(),
    paidAt: iso(charge.paidAt),
    expiresAt: charge.deadline.toISOString(),
  }
}

function pixInput(charge: WaDashboardPixCharge): ChargeInput {
  return {
    id: charge.id,
    method: 'Pix',
    status: charge.status,
    amount: charge.amount,
    paidAmount: charge.paidAmount,
    createdById: charge.createdById,
    createdByAi: charge.createdByAi,
    deadline: charge.expiresAt,
    paidAt: charge.paidAt,
    createdAt: charge.createdAt,
  }
}

function boletoInput(charge: WaDashboardBoletoCharge): ChargeInput {
  return {
    id: charge.id,
    method: 'Boleto',
    status: charge.status,
    amount: charge.amount,
    paidAmount: charge.paidAmount,
    createdById: charge.createdById,
    createdByAi: false,
    deadline: charge.dueAt,
    paidAt: charge.paidAt,
    createdAt: charge.createdAt,
  }
}

/**
 * One row per Pix or boleto charge, newest first, cut at `limit` (the
 * repository reads up to `limit` of each method).
 */
export function toWaChargeRows(
  data: WaChargeData,
  now: Date,
  limit: number,
): WaChargeDashboardRow[] {
  const names = namesById(data.users)
  return [
    ...data.pixCharges.map(pixInput),
    ...data.boletoCharges.map(boletoInput),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit)
    .map((charge) => toChargeRow(charge, names, now))
}

/* ------------------------------- appointments ------------------------------ */

export const WA_APPOINTMENT_STATUS_LABELS: Record<
  WhatsAppSchedAppointmentStatus,
  string
> = {
  PENDING: 'Aguardando confirmação',
  CONFIRMED: 'Confirmado',
  CANCELED: 'Cancelado',
  COMPLETED: 'Concluído',
  NO_SHOW: 'Faltou',
}

export const WA_APPOINTMENT_SOURCE_LABELS: Record<
  WhatsAppSchedAppointmentSource,
  string
> = {
  AGENT: 'Atendente',
  FLOW: 'Formulário (Flow)',
  CONTACT: 'Contato',
}

const NO_SHOW_PCT: Partial<Record<WhatsAppSchedAppointmentStatus, number>> = {
  NO_SHOW: 100,
  COMPLETED: 0,
}

/** One row per appointment, in the order the repository answered. */
export function toWaAppointmentRows(
  appointments: WaDashboardAppointment[],
  now: Date,
): WaAppointmentDashboardRow[] {
  return appointments.map((appointment) => ({
    id: appointment.id,
    service: appointment.service.name,
    professional: appointment.professional.name,
    status: WA_APPOINTMENT_STATUS_LABELS[appointment.status],
    origin: WA_APPOINTMENT_SOURCE_LABELS[appointment.source],
    durationMinutes: elapsed(
      appointment.startsAt,
      appointment.endsAt,
      MINUTE_MS,
      0,
    ),
    isUpcoming:
      (appointment.status === 'PENDING' ||
        appointment.status === 'CONFIRMED') &&
      appointment.startsAt.getTime() > now.getTime(),
    isCanceled: appointment.status === 'CANCELED',
    noShowPct: NO_SHOW_PCT[appointment.status] ?? null,
    leadHours: elapsed(appointment.createdAt, appointment.startsAt, HOUR_MS, 1),
    startsAt: appointment.startsAt.toISOString(),
    createdAt: appointment.createdAt.toISOString(),
    canceledAt: iso(appointment.canceledAt),
  }))
}

/* ----------------------------- chatbot sessions ---------------------------- */

export const WA_CHATBOT_SESSION_STATUS_LABELS: Record<
  WhatsAppChatbotSessionStatus,
  string
> = {
  RUNNING: 'Em andamento',
  HANDED_OFF_HUMAN: 'Passou para atendente',
  HANDED_OFF_AI: 'Passou para a IA',
  COMPLETED: 'Concluído',
  EXPIRED: 'Expirou',
  CANCELLED: 'Cancelado',
  FAILED: 'Falhou',
}

export const WA_CHATBOT_END_REASON_OTHER = 'Outro motivo'

/** `finished` is the runtime default when the engine names no reason. */
const EXTRA_END_REASON_LABELS: Record<string, string> = {
  finished: 'Chegou ao fim do fluxo',
}

function endReasonLabel(reason: string | null): string | null {
  if (!reason) return null
  return (
    END_REASON_LABEL[reason] ??
    EXTRA_END_REASON_LABELS[reason] ??
    WA_CHATBOT_END_REASON_OTHER
  )
}

/** One row per chatbot session, in the order the repository answered. */
export function toWaChatbotSessionRows(
  sessions: WaDashboardChatbotSession[],
): WaChatbotSessionDashboardRow[] {
  return sessions.map((session) => {
    const isRunning = session.status === 'RUNNING'
    const isFinished = session.status === 'COMPLETED'
    return {
      id: session.id,
      chatbot: session.chatbot.name,
      status: WA_CHATBOT_SESSION_STATUS_LABELS[session.status],
      isRunning,
      isFinished,
      isHandoff:
        session.status === 'HANDED_OFF_HUMAN' ||
        session.status === 'HANDED_OFF_AI',
      finishedPct: isRunning ? null : isFinished ? 100 : 0,
      endReason: endReasonLabel(session.endReason),
      durationMinutes: elapsed(
        session.startedAt,
        session.endedAt ?? session.lastActivityAt,
        MINUTE_MS,
        1,
      ),
      team: session.conversation.team?.name ?? null,
      connection: session.conversation.connection.label,
      startedAt: session.startedAt.toISOString(),
      endedAt: iso(session.endedAt),
    }
  })
}

/* ------------------------------ flow responses ----------------------------- */

export const WA_FLOW_RESPONSE_STATUS_LABELS: Record<
  WhatsAppFlowResponseStatus,
  string
> = {
  SENT: 'Aguardando resposta',
  COMPLETED: 'Respondido',
}

export const WA_FLOW_CATEGORY_OTHER = 'Outro'

/** Meta flow categories (`WhatsAppFlow.category` is a free string). */
const FLOW_CATEGORY_LABELS: Record<string, string> = {
  SIGN_UP: 'Cadastro',
  SIGN_IN: 'Login',
  APPOINTMENT_BOOKING: 'Agendamento',
  LEAD_GENERATION: 'Geração de leads',
  CONTACT_US: 'Fale conosco',
  CUSTOMER_SUPPORT: 'Suporte ao cliente',
  SURVEY: 'Pesquisa',
  OTHER: WA_FLOW_CATEGORY_OTHER,
}

function crmRecordOf(
  response: WaFlowResponseData['responses'][number],
): string | null {
  if (response.createdLeadId) return 'Lead'
  if (response.createdPersonId) return 'Pessoa'
  if (response.createdCompanyId) return 'Empresa'
  return null
}

/** One row per flow send, in the order the repository answered. */
export function toWaFlowResponseRows(
  data: WaFlowResponseData,
): WaFlowResponseDashboardRow[] {
  const names = namesById(data.users)
  return data.responses.map((response) => {
    const isCompleted = response.status === 'COMPLETED'
    return {
      id: response.id,
      flow: response.flow.name,
      category:
        FLOW_CATEGORY_LABELS[response.flow.category] ?? WA_FLOW_CATEGORY_OTHER,
      status: WA_FLOW_RESPONSE_STATUS_LABELS[response.status],
      isCompleted,
      completedPct: isCompleted ? 100 : 0,
      crmRecord: crmRecordOf(response),
      attendant: response.sentByUserId
        ? (names.get(response.sentByUserId) ?? null)
        : null,
      minutesToRespond: response.respondedAt
        ? elapsed(response.sentAt, response.respondedAt, MINUTE_MS, 1)
        : null,
      createdAt: response.sentAt.toISOString(),
      respondedAt: iso(response.respondedAt),
    }
  })
}

/* ----------------------------------- ads ----------------------------------- */

export const WA_AD_OTHER = 'Outro'

/** `sourceType` as Meta reports it (lower case). */
const AD_SOURCE_TYPE_LABELS: Record<string, string> = {
  ad: 'Anúncio',
  post: 'Publicação',
}

const AD_MEDIA_TYPE_LABELS: Record<string, string> = {
  image: 'Imagem',
  video: 'Vídeo',
}

/** One row per ad referral, in the order the repository answered. */
export function toWaAdReferralRows(
  data: WaAdReferralData,
): WaAdReferralDashboardRow[] {
  const conversations = new Map(
    data.conversations.map((conversation) => [conversation.id, conversation]),
  )
  return data.referrals.map((referral) => {
    const conversation = conversations.get(referral.conversationId)
    return {
      id: referral.id,
      sourceType: AD_SOURCE_TYPE_LABELS[referral.sourceType] ?? WA_AD_OTHER,
      adId: referral.sourceId,
      headline: referral.headline,
      ad: referral.headline || referral.sourceId,
      mediaType: referral.mediaType
        ? (AD_MEDIA_TYPE_LABELS[referral.mediaType] ?? WA_AD_OTHER)
        : null,
      connection: conversation?.connection.label ?? null,
      team: conversation?.team?.name ?? null,
      generatedLead: referral.leadId !== null,
      createdAt: referral.receivedAt.toISOString(),
    }
  })
}

/** One row per ad spend, in the order the repository answered. */
export function toWaAdSpendRows(
  spends: WaDashboardAdSpend[],
): WaAdSpendDashboardRow[] {
  return spends.map((spend) => {
    const amount = spend.amount.toNumber()
    // Inclusive days, as the ad report prorates; a reversed period is one.
    const periodDays = Math.max(
      1,
      Math.round(
        (spend.periodEnd.getTime() - spend.periodStart.getTime()) / DAY_MS,
      ) + 1,
    )
    return {
      id: spend.id,
      adId: spend.sourceId,
      ad: spend.label || spend.sourceId,
      amount,
      periodDays,
      dailyAmount: round(amount / periodDays, 2),
      periodStart: spend.periodStart.toISOString(),
      periodEnd: spend.periodEnd.toISOString(),
      createdAt: spend.createdAt.toISOString(),
    }
  })
}

/* --------------------------------- contacts -------------------------------- */

export const WA_OPT_OUT_SOURCE_LABELS: Record<WhatsAppOptOutSource, string> = {
  KEYWORD: 'Palavra-chave',
  ADMIN: 'Administrador',
  AI: 'IA',
}

function hasWhatsappLabel(value: boolean | null): string {
  if (value === null) return 'Não verificado'
  return value ? 'Sim' : 'Não'
}

/** One row per contact, in the order the repository answered. */
export function toWaContactRows(
  contacts: WaDashboardContact[],
): WaContactDashboardRow[] {
  return contacts.map((contact) => {
    const isOptedOut = contact.broadcastOptedOutAt !== null
    return {
      id: contact.id,
      hasWhatsapp: hasWhatsappLabel(contact.hasWhatsapp),
      isOptedOut,
      optOutSource:
        isOptedOut && contact.broadcastOptOutSource
          ? WA_OPT_OUT_SOURCE_LABELS[contact.broadcastOptOutSource]
          : null,
      isBlocked: contact.blocks.length > 0,
      hasCrmPerson: contact.crmPersonId !== null,
      createdAt: contact.createdAt.toISOString(),
      optedOutAt: iso(contact.broadcastOptedOutAt),
    }
  })
}
