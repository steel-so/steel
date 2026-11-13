import type { WhatsAppConnection } from '@prisma/client'
import { logger } from '@/lib/axiom/logger'
import {
  buildSdRequesterComponents,
  decideSdRequesterSend,
  type SdRequesterTemplates,
} from '@/src/lib/servicedesk/requester-whatsapp'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { SdRequesterWhatsappRepository } from '@/src/repositories/sd-requester-whatsapp.repository'

/**
 * WhatsApp notification to the REQUESTER (or external contact) of a ticket.
 *
 * - Meta: the template configured for the event in
 *   `SdSettings.requesterWhatsappTemplates` (if APPROVED); free text only
 *   inside the 24 h window and only when the channel was explicitly allowed.
 * - Z-API: no templates and no window; free text when the channel is allowed.
 * - A contact who opted out (`broadcastOptedOutAt`) is never messaged.
 *
 * Never throws; a repository failure skips the send (we cannot prove the
 * contact did not opt out) and is only logged.
 */

export type SdRequesterDeliveryOutcome = 'sent' | 'skipped' | 'failed'

export interface SdRequesterDeliveryInput {
  workspaceId: string
  connection: WhatsAppConnection
  templates: SdRequesterTemplates
  event: string
  ticket: { id: string; code: string; title: string }
  payload: { title: string; body: string }
  target: {
    label: string
    /** Normalized phone, digits only (the contact `waId`). */
    number: string
    /** Free text is an allowed channel for this target. */
    textAllowed: boolean
  }
}

export const SdRequesterWhatsapp = {
  async deliver(
    input: SdRequesterDeliveryInput,
  ): Promise<SdRequesterDeliveryOutcome> {
    const { connection, event, target } = input
    const log = {
      workspaceId: input.workspaceId,
      ticketId: input.ticket.id,
      event,
    }
    const config = input.templates[event]
    // Nothing configured and no free-text channel: nothing to send, no I/O.
    if (!config && !target.textAllowed) return 'skipped'

    const state = await SdRequesterWhatsappRepository.contactState(
      input.workspaceId,
      connection.id,
      target.number,
    )
    if (!state.ok) {
      logger.warn('servicedesk.notify.requester_whatsapp_state_failed', {
        ...log,
        reason: state.error.code,
      })
      return 'skipped'
    }

    let approved = false
    if (config && connection.provider === 'META') {
      const found = await SdRequesterWhatsappRepository.isTemplateApproved(
        input.workspaceId,
        connection.id,
        config.templateName,
        config.language,
      )
      approved = found.ok && found.value
    }

    const decision = decideSdRequesterSend({
      provider: connection.provider,
      optedOut: state.value.optedOut,
      templateConfigured: !!config,
      templateApproved: approved,
      textAllowed: target.textAllowed,
      lastInboundAt: state.value.lastInboundAt,
    })
    if (decision.action === 'skip') {
      logger.info('servicedesk.notify.requester_whatsapp_skipped', {
        ...log,
        reason: decision.reason,
      })
      return 'skipped'
    }

    const sent =
      decision.action === 'template' && config
        ? await WhatsAppSend.template(connection, {
            to: target.number,
            templateName: config.templateName,
            language: config.language,
            components: buildSdRequesterComponents(config, {
              code: input.ticket.code,
              title: input.ticket.title,
              headline: input.payload.title,
              message: input.payload.body,
              requester: target.label,
            }),
          })
        : await WhatsAppSend.text(connection, {
            to: target.number,
            text: `*${input.ticket.code}* — ${input.payload.title}\n${input.payload.body}`,
          })
    if (sent.ok) return 'sent'
    logger.warn('servicedesk.notify.whatsapp_failed', {
      ...log,
      requester: true,
      reason: sent.error.code,
    })
    return 'failed'
  },
}
