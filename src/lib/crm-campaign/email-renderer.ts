import 'server-only'
import { ok, type Result } from '@/src/lib/result'
import { CrmEmailBuilderRepository } from '@/src/repositories/crm-email-builder.repository'
import type { EmailBuilderContact } from '@/src/schemas/crm-email-builder.schema'
import {
  personToContact,
  renderCampaignEmail as renderBuilderEmail,
} from '@/src/services/crm-email-builder.service'

/**
 * Campaign e-mail rendering seam (ADR 0025). The campaign only depends on
 * `renderCampaignEmail(templateId, contact)`; it delegates to the visual
 * e-mail builder's render API (`crm-email-builder.service`), which handles
 * builder and legacy templates, the `{{campaign_link}}` variable and the
 * LGPD unsubscribe footer.
 */

export interface CampaignEmailContact {
  /** Tenant scope — the template must belong to this workspace. */
  workspaceId: string
  name: string
  email: string
  /** Tracked campaign link of this recipient (CTA target). */
  campaignLink: string
  /**
   * Unsubscribe page of this recipient; omitted on previews and test sends
   * (the builder then links its generic page).
   */
  unsubscribeUrl?: string
  /**
   * CRM person behind the recipient: fills the profile variables
   * (`{{empresa}}`, `{{cargo}}`, `{{cidade}}`…) and the list membership of
   * "Mostrar se" conditions, so each recipient gets their own version.
   */
  personId?: string | null
}

export interface RenderedCampaignEmail {
  subject: string
  html: string
  text: string
}

export type RenderCampaignEmail = (
  templateId: string,
  contact: CampaignEmailContact,
) => Promise<Result<RenderedCampaignEmail>>

/** The recipient's name/e-mail plus the CRM person's profile fields. */
async function recipientContact(
  contact: CampaignEmailContact,
): Promise<Result<EmailBuilderContact>> {
  const base = { name: contact.name, email: contact.email }
  if (!contact.personId) return ok(base)
  const people = await CrmEmailBuilderRepository.findContacts(
    contact.workspaceId,
    [contact.personId],
  )
  if (!people.ok) return people
  const [person] = people.value
  // The snapshot's name and address win: they are what the campaign used.
  return ok(person ? { ...personToContact(person), ...base } : base)
}

export const renderCampaignEmail: RenderCampaignEmail = async (
  templateId,
  contact,
) => {
  const recipient = await recipientContact(contact)
  if (!recipient.ok) return recipient
  return renderBuilderEmail(templateId, recipient.value, {
    workspaceId: contact.workspaceId,
    campaignLink: contact.campaignLink,
    unsubscribeUrl: contact.unsubscribeUrl,
    ...(contact.personId ? { personId: contact.personId } : {}),
  })
}
