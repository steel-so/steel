import type { CrmNewsletterIssue, Prisma } from '@prisma/client'
import { logger } from '@/lib/axiom/logger'
import { crmNewsletterSegmentInvalid } from '@/src/errors'
import {
  compileNewsletterSegment,
  customFieldKey,
  parseStoredSegment,
  segmentNeeds,
} from '@/src/lib/crm-newsletter/segment-where'
import { err, ok, type Result } from '@/src/lib/result'
import { CrmNewsletterSegmentRepository } from '@/src/repositories/crm-newsletter-segment.repository'
import {
  isEmptySegment,
  type NewsletterSegment,
} from '@/src/schemas/crm-newsletter-segment.schema'

/**
 * Audience of a newsletter issue (newsletter2, slice nl2-segments): resolves
 * what a segment needs from the database and compiles it to the subscriber
 * filter. Shared by the segment service, the send dialog's pre-flight and
 * the send flow — kept apart from them so none imports the other.
 */

type SubscriberWhere = Prisma.CrmNewsletterSubscriberWhereInput

/**
 * Checks the references of a segment (custom fields must be PERSON fields
 * of the workspace) and compiles it. `null` = no condition (everyone).
 */
export async function resolveSegmentWhere(
  workspaceId: string,
  newsletterId: string,
  segment: NewsletterSegment,
): Promise<Result<SubscriberWhere | null>> {
  if (isEmptySegment(segment)) return ok(null)
  const needs = segmentNeeds(segment)

  const customFieldPersonIds: Record<string, string[]> = {}
  if (needs.customFields.length > 0) {
    const definitionIds = [
      ...new Set(needs.customFields.map((field) => field.definitionId)),
    ]
    const definitions = await CrmNewsletterSegmentRepository.personCustomFields(
      workspaceId,
      definitionIds,
    )
    if (!definitions.ok) return definitions
    if (definitions.value.length !== definitionIds.length) {
      return err(
        crmNewsletterSegmentInvalid(
          'Um campo personalizado usado no público não existe mais',
        ),
      )
    }
    for (const condition of needs.customFields) {
      const ids = await CrmNewsletterSegmentRepository.customFieldPersonIds(
        workspaceId,
        condition,
      )
      if (!ids.ok) return ids
      customFieldPersonIds[customFieldKey(condition)] = ids.value
    }
  }

  const recent = await CrmNewsletterSegmentRepository.recentSentIssueIds(
    newsletterId,
    needs.lookback,
  )
  if (!recent.ok) return recent

  return ok(
    compileNewsletterSegment(segment, {
      recentIssueIds: recent.value,
      customFieldPersonIds,
    }),
  )
}

/**
 * Filter of an issue's audience for the send flow (pre-send checks and the
 * snapshot). `undefined` = everyone (phase-1 behaviour); a stored segment
 * that no longer parses refuses the send instead of mailing everybody.
 */
export async function issueAudienceWhere(
  issue: Pick<CrmNewsletterIssue, 'id' | 'workspaceId' | 'newsletterId'> & {
    segment: Prisma.JsonValue
  },
): Promise<Result<SubscriberWhere | undefined>> {
  const stored = parseStoredSegment(issue.segment)
  if (!stored) {
    logger.warn('crm.newsletter.segment_unreadable', {
      component: 'CrmNewsletterSegmentService',
      issueId: issue.id,
    })
    return err(crmNewsletterSegmentInvalid())
  }
  const where = await resolveSegmentWhere(
    issue.workspaceId,
    issue.newsletterId,
    stored,
  )
  if (!where.ok) return where
  return ok(where.value ?? undefined)
}
