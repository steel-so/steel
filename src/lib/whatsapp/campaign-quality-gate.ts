import 'server-only'
import type { WhatsAppConnection, WhatsAppTemplate } from '@prisma/client'
import { whatsappQualityBlocked } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import { metaNumberQualityOf } from '@/src/lib/whatsapp/meta-number-quality'

/**
 * Quality gate of AI campaign template sends: while Meta rates the sending
 * number, or the campaign template, RED, nothing is sent (keeps the rating
 * from sinking further and the messaging limit from dropping). Only a
 * definite RED blocks: a non-Meta connection or a lookup that cannot be made
 * reads as UNKNOWN and is let through. Direct messages (attendants, replies
 * in the 24 h window, AI replies) never go through here.
 */
export async function assertCampaignSendAllowed(
  connection: Pick<
    WhatsAppConnection,
    'id' | 'provider' | 'metaPhoneNumberId' | 'encryptedMetaAccessToken'
  >,
  template: Pick<WhatsAppTemplate, 'name' | 'quality'>,
): Promise<Result<void>> {
  const numberQuality = await metaNumberQualityOf(connection)
  if (numberQuality === 'RED') return err(whatsappQualityBlocked('NUMBER'))
  if (template.quality === 'RED') {
    return err(whatsappQualityBlocked('TEMPLATE', template.name))
  }
  return ok(undefined)
}
