import type {
  CrmNewsletterIssueWhatsApp,
  CrmNewsletterWhatsAppRecipient,
} from '@prisma/client'
import { formatE164 } from '@/src/lib/crm-campaign/phone'
import {
  type CrmNewsletterIssueWhatsAppDTO,
  type CrmNewsletterWhatsAppRecipientDTO,
  type CrmNewsletterWhatsAppVariables,
  CrmNewsletterWhatsAppVariablesSchema,
} from '@/src/schemas/crm-newsletter-engage.schema'

/** Stored mapping → DTO (`null` when absent or no longer valid). */
export function toWhatsAppVariables(
  value: unknown,
): CrmNewsletterWhatsAppVariables | null {
  if (value === null || value === undefined) return null
  const parsed = CrmNewsletterWhatsAppVariablesSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function toCrmNewsletterIssueWhatsAppDTO(
  issueId: string,
  config: CrmNewsletterIssueWhatsApp | null,
  extras: Pick<
    CrmNewsletterIssueWhatsAppDTO,
    'available' | 'unavailableReason' | 'problems' | 'reach'
  >,
): CrmNewsletterIssueWhatsAppDTO {
  return {
    issueId,
    enabled: config?.enabled ?? false,
    connectionId: config?.connectionId ?? null,
    templateId: config?.templateId ?? null,
    variables: toWhatsAppVariables(config?.variables),
    text: config?.text ?? null,
    legalBasis: config?.legalBasis ?? null,
    consentConfirmedAt: config?.consentConfirmedAt?.toISOString() ?? null,
    startedAt: config?.startedAt?.toISOString() ?? null,
    ...extras,
  }
}

export function toCrmNewsletterWhatsAppRecipientDTO(
  row: CrmNewsletterWhatsAppRecipient,
): CrmNewsletterWhatsAppRecipientDTO {
  return {
    id: row.id,
    name: row.name,
    phone: formatE164(row.waId),
    personId: row.personId,
    status: row.status,
    skipReason: row.skipReason,
    error: row.error,
    sentAt: row.sentAt?.toISOString() ?? null,
  }
}
