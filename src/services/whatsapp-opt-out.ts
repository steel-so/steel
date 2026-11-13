import { logger } from '@/lib/axiom/logger'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'

/**
 * Single LGPD gate for outbound WhatsApp that is not an answer to the
 * contact (document delivery, ServiceDesk notifications). A contact that
 * opted out (`broadcastOptedOutAt`) must not receive it.
 *
 * `unverified` means the lookup failed: callers must skip the send too
 * (fail closed), because an opt-out we could not read may still exist.
 */
export type WhatsAppOptOutStatus = 'allowed' | 'opted_out' | 'unverified'

export const WHATSAPP_OPTED_OUT_MESSAGE =
  'Este contato pediu para não receber mensagens por WhatsApp (LGPD). Envie por outro canal ou copie o link.'
export const WHATSAPP_OPT_OUT_UNVERIFIED_MESSAGE =
  'Não foi possível confirmar se o contato aceita mensagens por WhatsApp. Tente novamente em instantes ou use outro canal.'

export async function checkWhatsAppOptOut(
  workspaceId: string,
  waId: string,
): Promise<WhatsAppOptOutStatus> {
  const contact = await WhatsAppContactRepository.findByWaId(workspaceId, waId)
  if (!contact.ok) {
    logger.warn('whatsapp.opt_out.lookup_failed', {
      workspaceId,
      code: contact.error.code,
    })
    return 'unverified'
  }
  return contact.value?.broadcastOptedOutAt ? 'opted_out' : 'allowed'
}
