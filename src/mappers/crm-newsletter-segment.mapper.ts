import type { CrmNewsletterSegment } from '@prisma/client'
import type { StoredIssueSegment } from '@/src/schemas/crm-newsletter-segment.schema'
import {
  type CrmNewsletterIssueSegmentDTO,
  type CrmNewsletterSegmentDTO,
  isEmptySegment,
  type NewsletterSegment,
  NewsletterSegmentSchema,
} from '@/src/schemas/crm-newsletter-segment.schema'

const EMPTY: NewsletterSegment = { conditions: [], groups: [] }

export function toCrmNewsletterSegmentDTO(
  row: CrmNewsletterSegment,
): CrmNewsletterSegmentDTO {
  const parsed = NewsletterSegmentSchema.safeParse(row.definition ?? {})
  return {
    id: row.id,
    newsletterId: row.newsletterId,
    name: row.name,
    definition: parsed.success ? parsed.data : EMPTY,
    valid: parsed.success,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** The "Público" of an issue, from its parsed `segment` column. */
export function toCrmNewsletterIssueSegmentDTO(
  stored: StoredIssueSegment,
  savedSegmentName: string | null,
): CrmNewsletterIssueSegmentDTO {
  const segment = { conditions: stored.conditions, groups: stored.groups }
  return {
    segment,
    savedSegmentId: stored.savedSegmentId ?? null,
    savedSegmentName,
    everyone: isEmptySegment(segment),
  }
}
