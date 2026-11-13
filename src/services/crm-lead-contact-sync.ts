import 'server-only'
import type { WhatsAppContact } from '@prisma/client'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import { toStoredPhone } from '@/src/lib/phone-br'
import { ok, type Result } from '@/src/lib/result'
import { whatsappCandidates } from '@/src/lib/servicedesk/document'
import {
  isLeadWhatsAppPhone,
  LEAD_CONTACT_DESCRIPTION,
} from '@/src/lib/whatsapp/lead-contact'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { assertModuleEnabled } from './authz'

/**
 * The WhatsApp contact for a lead phone. An existing contact (the person
 * already wrote to us, with or without the ninth digit) is reused and only
 * gets the "Lead do CRM" description when it has none; otherwise a new
 * contact is created with it. Null when the phone is not usable.
 */
export async function ensureLeadContact(
  workspaceId: string,
  name: string,
  phone: string,
): Promise<Result<WhatsAppContact | null>> {
  const waId = toStoredPhone(phone)
  if (!waId || !isLeadWhatsAppPhone(waId)) return ok(null)

  const found = await WhatsAppContactRepository.findManyByWaIds(
    workspaceId,
    whatsappCandidates(waId),
  )
  if (!found.ok) return found

  const existing =
    found.value.find((contact) => contact.waId === waId) ?? found.value[0]
  if (existing) {
    if (existing.description?.trim()) return ok(existing)
    return WhatsAppContactRepository.update(existing.id, {
      description: LEAD_CONTACT_DESCRIPTION,
      ...(existing.name || !name ? {} : { name }),
    })
  }

  const created = await WhatsAppContactRepository.create({
    workspaceId,
    waId,
    name: name || undefined,
    description: LEAD_CONTACT_DESCRIPTION,
  })
  // Lost a race with another writer: the contact exists now.
  if (!created.ok && created.error.code === 'CONFLICT') {
    const again = await WhatsAppContactRepository.findByWaId(workspaceId, waId)
    return again.ok ? ok(again.value) : again
  }
  return created
}

/**
 * Makes the phones of a lead show up in Comunicação as contacts, when the
 * workspace has both modules. Best effort: it never fails the lead write.
 */
export async function syncLeadContacts(
  workspaceId: string,
  name: string,
  phones: string[],
): Promise<void> {
  if (phones.length === 0) return
  try {
    const enabled = await assertModuleEnabled(workspaceId, 'COMMUNICATION')
    if (!enabled.ok) return
    for (const phone of phones) {
      const result = await ensureLeadContact(workspaceId, name, phone)
      if (!result.ok) {
        logger.warn(
          'crm.lead.whatsapp_contact_failed',
          logFields(
            { component: 'CrmLeadContactSync', workspaceId },
            { code: result.error.code },
          ),
        )
      }
    }
  } catch (error) {
    logger.warn(
      'crm.lead.whatsapp_contact_failed',
      logFields(
        { component: 'CrmLeadContactSync', workspaceId },
        { message: error instanceof Error ? error.message : String(error) },
      ),
    )
  }
}
