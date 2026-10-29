import { logger } from '@/lib/axiom/logger'
import { digitsOnly } from '@/src/lib/crm-cadence/merge'
import {
  CrmCadenceEnrollmentRepository,
  CrmCadenceRepository,
} from '@/src/repositories/crm-cadence.repository'

/**
 * "The lead answered": stops the open enrollments of the leads that own the
 * e-mail address or the phone, when their cadence stops on reply. Called by
 * the WhatsApp inbound path and by the CRM e-mail log (inbound message). It
 * never throws and never fails the caller: a problem is logged and the
 * seller can still stop the enrollment by hand.
 */
export const CrmCadenceReplyService = {
  async onWhatsAppReply(
    workspaceId: string,
    waId: string,
    now: Date = new Date(),
  ): Promise<number> {
    try {
      const ids = await CrmCadenceRepository.stopOnReplyEnrollmentIdsByPhone(
        workspaceId,
        digitsOnly(waId),
      )
      if (!ids.ok) return logFailure('whatsapp', workspaceId, ids.error.code)
      const stopped = await CrmCadenceEnrollmentRepository.finish(
        ids.value,
        'REPLIED',
        'REPLIED',
        'WHATSAPP',
        now,
      )
      if (!stopped.ok) {
        return logFailure('whatsapp', workspaceId, stopped.error.code)
      }
      return stopped.value
    } catch (error) {
      return logFailure('whatsapp', workspaceId, String(error))
    }
  },

  async onEmailReply(
    workspaceId: string,
    fromEmail: string,
    now: Date = new Date(),
  ): Promise<number> {
    try {
      const email = fromEmail.trim().toLowerCase()
      if (!email) return 0
      const ids = await CrmCadenceRepository.stopOnReplyEnrollmentIdsByEmail(
        workspaceId,
        [email],
      )
      if (!ids.ok) return logFailure('email', workspaceId, ids.error.code)
      const stopped = await CrmCadenceEnrollmentRepository.finish(
        ids.value,
        'REPLIED',
        'REPLIED',
        'EMAIL',
        now,
      )
      if (!stopped.ok)
        return logFailure('email', workspaceId, stopped.error.code)
      return stopped.value
    } catch (error) {
      return logFailure('email', workspaceId, String(error))
    }
  },
}

function logFailure(channel: string, workspaceId: string, reason: string): 0 {
  logger.warn('crm.cadence.reply_stop_failed', {
    component: 'CrmCadenceReplyService',
    channel,
    workspaceId,
    reason,
  })
  return 0
}
