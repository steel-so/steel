import { ok, type Result } from '@/src/lib/result'
import {
  toWaAdReferralRows,
  toWaAdSpendRows,
  toWaAppointmentRows,
  toWaCallRows,
  toWaChargeRows,
  toWaChatbotSessionRows,
  toWaContactRows,
  toWaFlowResponseRows,
} from '@/src/mappers/whatsapp-dashboard-channels.mapper'
import { WhatsAppDashboardChannelsRepository } from '@/src/repositories/whatsapp-dashboard-channels.repository'
import type { WaChannelDashboardRow } from '@/types/whatsapp-dashboard-channels'

/**
 * Loaders of the channel sources of the Comunicação dashboards, merged into
 * the `LOADERS` registry of `whatsapp-dashboard-source.service.ts` (which
 * owns the access check, the history window and the row ceiling).
 */

export type WaChannelSource =
  | 'whatsapp-calls'
  | 'whatsapp-charges'
  | 'whatsapp-appointments'
  | 'whatsapp-chatbot-sessions'
  | 'whatsapp-flow-responses'
  | 'whatsapp-ad-referrals'
  | 'whatsapp-ad-spends'
  | 'whatsapp-contacts'

type ChannelLoader = (
  workspaceId: string,
  since: Date,
  limit: number,
) => Promise<Result<WaChannelDashboardRow[]>>

const repo = WhatsAppDashboardChannelsRepository

export const WA_CHANNEL_LOADERS: Record<WaChannelSource, ChannelLoader> = {
  'whatsapp-calls': async (workspaceId, since, limit) => {
    const calls = await repo.calls(workspaceId, since, limit)
    if (!calls.ok) return calls
    return ok(toWaCallRows(calls.value))
  },
  'whatsapp-charges': async (workspaceId, since, limit) => {
    const data = await repo.chargeData(workspaceId, since, limit)
    if (!data.ok) return data
    return ok(toWaChargeRows(data.value, new Date(), limit))
  },
  'whatsapp-appointments': async (workspaceId, since, limit) => {
    const appointments = await repo.appointments(workspaceId, since, limit)
    if (!appointments.ok) return appointments
    return ok(toWaAppointmentRows(appointments.value, new Date()))
  },
  'whatsapp-chatbot-sessions': async (workspaceId, since, limit) => {
    const sessions = await repo.chatbotSessions(workspaceId, since, limit)
    if (!sessions.ok) return sessions
    return ok(toWaChatbotSessionRows(sessions.value))
  },
  'whatsapp-flow-responses': async (workspaceId, since, limit) => {
    const data = await repo.flowResponseData(workspaceId, since, limit)
    if (!data.ok) return data
    return ok(toWaFlowResponseRows(data.value))
  },
  'whatsapp-ad-referrals': async (workspaceId, since, limit) => {
    const data = await repo.adReferralData(workspaceId, since, limit)
    if (!data.ok) return data
    return ok(toWaAdReferralRows(data.value))
  },
  'whatsapp-ad-spends': async (workspaceId, since, limit) => {
    const spends = await repo.adSpends(workspaceId, since, limit)
    if (!spends.ok) return spends
    return ok(toWaAdSpendRows(spends.value))
  },
  'whatsapp-contacts': async (workspaceId, since, limit) => {
    const contacts = await repo.contacts(workspaceId, since, limit)
    if (!contacts.ok) return contacts
    return ok(toWaContactRows(contacts.value))
  },
}
