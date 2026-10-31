import type { WhatsAppConnection, WhatsAppContact } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { ok, type Result } from '@/src/lib/result'
import { parseAppointmentReply } from '@/src/lib/whatsapp/scheduling/replies'
import { formatAppointmentDate } from '@/src/lib/whatsapp/scheduling/time'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import {
  WhatsAppSchedAppointmentRepository,
  WhatsAppSchedulingSettingsRepository,
} from '@/src/repositories/whatsapp-scheduling.repository'
import { recordOutboundMessage } from './whatsapp-automation-send.service'

export interface InboundSchedulingReply {
  workspaceId: string
  connection: WhatsAppConnection
  contact: WhatsAppContact
  conversationId: string
  text: string
  now?: Date
}

export const WhatsAppSchedulingReplyService = {
  /**
   * The contact answered a confirmation / reminder with CONFIRMAR or
   * CANCELAR (or the matching template button). `handled: true` keeps the AI
   * and the chatbot out of the exchange.
   */
  async handleInbound(
    input: InboundSchedulingReply,
  ): Promise<Result<{ handled: boolean }>> {
    const reply = parseAppointmentReply(input.text)
    if (!reply) return ok({ handled: false })

    const settings = await WhatsAppSchedulingSettingsRepository.findByWorkspace(
      input.workspaceId,
    )
    if (!settings.ok) return settings
    if (!settings.value?.enabled) return ok({ handled: false })

    const now = input.now ?? new Date()
    const next = await WhatsAppSchedAppointmentRepository.findNextNotified(
      input.workspaceId,
      input.contact.id,
      now,
    )
    if (!next.ok) return next
    const appointment = next.value
    if (!appointment) return ok({ handled: false })

    const when = formatAppointmentDate(
      appointment.startsAt,
      settings.value.timezone,
    )
    let text: string
    if (reply === 'CONFIRM') {
      if (appointment.status === 'PENDING') {
        const updated = await WhatsAppSchedAppointmentRepository.update(
          appointment.id,
          { status: 'CONFIRMED', confirmedAt: now },
        )
        if (!updated.ok) return updated
      }
      text = `Presença confirmada: ${appointment.service.name}, ${when}. Até lá!`
    } else {
      const updated = await WhatsAppSchedAppointmentRepository.update(
        appointment.id,
        {
          status: 'CANCELED',
          canceledAt: now,
          cancelReason: 'Cancelado pelo cliente',
        },
      )
      if (!updated.ok) return updated
      text = `Agendamento cancelado: ${appointment.service.name}, ${when}. Se quiser remarcar, é só nos chamar por aqui.`
    }

    auditMutation({
      entity: 'whatsapp_sched_appointment',
      action: reply === 'CONFIRM' ? 'accept' : 'cancel',
      actorId: null,
      targetId: appointment.id,
      meta: { workspaceId: input.workspaceId, via: 'whatsapp_reply' },
    })

    // The window just opened: answer in plain text.
    const sent = await WhatsAppSend.text(
      input.connection,
      { to: input.contact.waId, text },
      { cost: { source: 'OTHER', conversationId: input.conversationId } },
    )
    if (!sent.ok) {
      logger.warn('whatsapp.scheduling.reply_ack_failed', {
        appointmentId: appointment.id,
        reason: sent.error.code,
      })
      return ok({ handled: true })
    }
    await recordOutboundMessage({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      type: 'TEXT',
      text,
      providerMessageId: sent.value.providerMessageId,
    })
    return ok({ handled: true })
  },
}
