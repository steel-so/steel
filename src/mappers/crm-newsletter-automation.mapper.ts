import type {
  CrmNewsletterReengagementSettings,
  CrmNewsletterWelcomeStep,
} from '@prisma/client'
import {
  CRM_NEWSLETTER_REENGAGEMENT_DEFAULTS,
  type CrmNewsletterReengagementDTO,
  type CrmNewsletterReengagementPreviewDTO,
  type CrmNewsletterReengagementTotalsDTO,
  type CrmNewsletterWelcomeStepDTO,
  type CrmNewsletterWelcomeStepStatsDTO,
} from '@/src/schemas/crm-newsletter-automation.schema'

/** Newsletter automation (slice nl2-automation): Prisma rows → API DTOs. */

const NO_STATS: CrmNewsletterWelcomeStepStatsDTO = {
  sent: 0,
  opened: 0,
  clicked: 0,
}

export function toCrmNewsletterWelcomeStepDTO(
  step: CrmNewsletterWelcomeStep,
  options: {
    stats?: CrmNewsletterWelcomeStepStatsDTO | null
    includeDocument?: boolean
  } = {},
): CrmNewsletterWelcomeStepDTO {
  return {
    id: step.id,
    newsletterId: step.newsletterId,
    position: step.position,
    delayValue: step.delayValue,
    delayUnit: step.delayUnit,
    subject: step.subject,
    preheader: step.preheader,
    enabled: step.enabled,
    stats: options.stats ?? NO_STATS,
    ...(options.includeDocument
      ? { builderDocument: step.builderDocument }
      : {}),
    createdAt: step.createdAt.toISOString(),
    updatedAt: step.updatedAt.toISOString(),
  }
}

/** Saved settings, or the defaults (off) of a section never saved. */
export function toCrmNewsletterReengagementDTO(
  newsletterId: string,
  settings: CrmNewsletterReengagementSettings | null,
  extra: {
    preview: CrmNewsletterReengagementPreviewDTO
    totals: CrmNewsletterReengagementTotalsDTO
  },
): CrmNewsletterReengagementDTO {
  const values = settings ?? CRM_NEWSLETTER_REENGAGEMENT_DEFAULTS
  return {
    newsletterId,
    saved: settings !== null,
    enabled: values.enabled,
    minIssues: values.minIssues,
    inactiveDays: values.inactiveDays,
    graceDays: values.graceDays,
    action: values.action,
    subject: values.subject,
    heading: values.heading,
    body: values.body,
    buttonLabel: values.buttonLabel,
    updatedAt: settings ? settings.updatedAt.toISOString() : null,
    preview: extra.preview,
    totals: extra.totals,
  }
}
